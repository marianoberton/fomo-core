/**
 * MemoryManager — manages the 4-layer memory system.
 *
 * Layer 1: Context Window — tracks token budget, fits messages into model limit
 * Layer 2: Pruning — drops old tool results, preserves head + tail of conversation
 * Layer 3: Compaction — LLM-summarized compression (via callback)
 * Layer 4: Long-term — pgvector semantic search (via injected store)
 *
 * Layers 1-2 are pure in-memory operations.
 * Layers 3-4 require external dependencies (LLM for summarization, DB for storage).
 */
import type { MemoryConfig } from '@/core/types.js';
import type { Message } from '@/providers/types.js';
import { createLogger } from '@/observability/logger.js';
import type { MemoryEntry, MemoryRetrieval, RetrievedMemory, CompactionEntry } from './types.js';

const logger = createLogger({ name: 'memory-manager' });

/** Callback for token counting (delegated to the active LLM provider). */
export type TokenCounter = (messages: Message[]) => Promise<number>;

/** Callback for LLM-based compaction summarization. */
export type CompactionSummarizer = (messages: Message[]) => Promise<string>;

/** Interface for the long-term memory store (pgvector-backed). */
export interface LongTermMemoryStore {
  store(entry: Omit<MemoryEntry, 'id' | 'accessCount' | 'lastAccessedAt' | 'createdAt'>): Promise<MemoryEntry>;
  retrieve(query: MemoryRetrieval): Promise<RetrievedMemory[]>;
  delete(id: string): Promise<boolean>;
}

export interface MemoryManagerOptions {
  memoryConfig: MemoryConfig;
  contextWindowSize: number;
  tokenCounter: TokenCounter;
  compactionSummarizer?: CompactionSummarizer;
  longTermStore?: LongTermMemoryStore;
}

export interface MemoryManager {
  /**
   * Fit messages into the context window.
   * Returns the messages that fit within the token budget,
   * with pruning applied if necessary.
   */
  fitToContextWindow(messages: Message[]): Promise<Message[]>;

  /**
   * Trigger compaction on a set of messages.
   * Returns the compacted messages and a CompactionEntry record.
   * Requires a compactionSummarizer to be configured.
   */
  compact(
    messages: Message[],
    sessionId: string,
  ): Promise<{ messages: Message[]; entry: CompactionEntry }>;

  /**
   * Retrieve relevant long-term memories.
   * Returns empty array if no long-term store is configured.
   */
  retrieveMemories(query: MemoryRetrieval): Promise<RetrievedMemory[]>;

  /**
   * Store a memory entry in the long-term store.
   * No-op if long-term store is not configured.
   */
  storeMemory(entry: Omit<MemoryEntry, 'id' | 'accessCount' | 'lastAccessedAt' | 'createdAt'>): Promise<MemoryEntry | null>;
}

/**
 * Estimate tokens for a single message (rough heuristic: 4 chars per token).
 * Used only as fallback when we can't count the full batch.
 */
function estimateMessageTokens(msg: Message): number {
  if (typeof msg.content === 'string') {
    return Math.ceil(msg.content.length / 4);
  }
  let chars = 0;
  for (const part of msg.content) {
    if (part.type === 'text') chars += part.text.length;
    else if (part.type === 'tool_result') chars += part.content.length;
    else chars += JSON.stringify(part.input).length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Prune messages using turn-based strategy.
 * Preserves the first `keep` messages (system context / conversation start)
 * and the last `keep` messages (recent conversation tail).
 * Drops tool_result content preferentially from the middle.
 */
function pruneTurnBased(
  messages: Message[],
  maxTurns: number,
): Message[] {
  if (messages.length <= maxTurns) return messages;

  const keep = Math.max(2, Math.floor(maxTurns / 2));
  const head = messages.slice(0, keep);
  const tail = messages.slice(-keep);

  logger.debug('Pruned messages (turn-based)', {
    component: 'memory-manager',
    original: messages.length,
    kept: head.length + tail.length,
    dropped: messages.length - head.length - tail.length,
  });

  return [...head, ...tail];
}

/**
 * Prune messages using token-based strategy.
 * Works backwards from the most recent messages, adding until budget is hit.
 * Always includes the first message (system context).
 */
async function pruneTokenBased(
  messages: Message[],
  tokenBudget: number,
  tokenCounter: TokenCounter,
): Promise<Message[]> {
  if (messages.length === 0) return [];

  // Always keep the first message
  const first = messages[0];
  if (!first) return [];
  const firstTokens = await tokenCounter([first]);
  let remainingBudget = tokenBudget - firstTokens;

  if (remainingBudget <= 0) return [first];

  // Work backwards from the end
  const kept: Message[] = [];
  for (let i = messages.length - 1; i >= 1; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const msgTokens = estimateMessageTokens(msg);
    if (msgTokens <= remainingBudget) {
      kept.unshift(msg);
      remainingBudget -= msgTokens;
    }
  }

  logger.debug('Pruned messages (token-based)', {
    component: 'memory-manager',
    original: messages.length,
    kept: kept.length + 1,
    tokenBudget,
  });

  return [first, ...kept];
}

/**
 * Create a new MemoryManager instance.
 */
export function createMemoryManager(options: MemoryManagerOptions): MemoryManager {
  const { memoryConfig, contextWindowSize, tokenCounter, compactionSummarizer, longTermStore } =
    options;
  const reserveTokens = memoryConfig.contextWindow.reserveTokens;
  const availableTokens = contextWindowSize - reserveTokens;

  return {
    async fitToContextWindow(messages: Message[]): Promise<Message[]> {
      const totalTokens = await tokenCounter(messages);

      if (totalTokens <= availableTokens) {
        return messages;
      }

      logger.info('Messages exceed context window, pruning', {
        component: 'memory-manager',
        totalTokens,
        availableTokens,
        messageCount: messages.length,
        strategy: memoryConfig.contextWindow.pruningStrategy,
      });

      if (memoryConfig.contextWindow.pruningStrategy === 'turn-based') {
        return pruneTurnBased(messages, memoryConfig.contextWindow.maxTurnsInContext);
      }

      return pruneTokenBased(messages, availableTokens, tokenCounter);
    },

    async compact(
      messages: Message[],
      sessionId: string,
    ): Promise<{ messages: Message[]; entry: CompactionEntry }> {
      if (!compactionSummarizer) {
        throw new Error('Compaction requires a compactionSummarizer to be configured');
      }

      if (!memoryConfig.contextWindow.compaction.enabled) {
        throw new Error('Compaction is not enabled in memory config');
      }

      const originalCount = messages.length;
      const summary = await compactionSummarizer(messages);

      const compactedMessages: Message[] = [
        {
          role: 'system',
          content: `[Compacted conversation summary]\n${summary}`,
        },
        // Keep the last few messages for immediate context
        ...messages.slice(-4),
      ];

      const originalTokens = await tokenCounter(messages);
      const compactedTokens = await tokenCounter(compactedMessages);

      const entry: CompactionEntry = {
        sessionId: sessionId as CompactionEntry['sessionId'],
        summary,
        messagesCompacted: originalCount,
        tokensRecovered: originalTokens - compactedTokens,
        createdAt: new Date(),
      };

      logger.info('Compacted conversation', {
        component: 'memory-manager',
        sessionId,
        messagesCompacted: originalCount,
        tokensRecovered: entry.tokensRecovered,
      });

      return { messages: compactedMessages, entry };
    },

    async retrieveMemories(query: MemoryRetrieval): Promise<RetrievedMemory[]> {
      if (!longTermStore || !memoryConfig.longTerm.enabled) {
        return [];
      }

      const results = await longTermStore.retrieve(query);

      logger.debug('Retrieved long-term memories', {
        component: 'memory-manager',
        query: query.query,
        topK: query.topK,
        resultsCount: results.length,
      });

      return results;
    },

    async storeMemory(
      entry: Omit<MemoryEntry, 'id' | 'accessCount' | 'lastAccessedAt' | 'createdAt'>,
    ): Promise<MemoryEntry | null> {
      if (!longTermStore || !memoryConfig.longTerm.enabled) {
        return null;
      }

      const stored = await longTermStore.store(entry);

      logger.debug('Stored long-term memory', {
        component: 'memory-manager',
        category: entry.category,
        importance: entry.importance,
      });

      return stored;
    },
  };
}
