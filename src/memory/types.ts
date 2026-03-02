import type { ProjectId, SessionId } from '@/core/types.js';
import type { AgentId } from '@/agents/types.js';

// ─── Memory Categories ──────────────────────────────────────────

export type MemoryCategory = 'fact' | 'decision' | 'preference' | 'task_context' | 'learning';

// ─── Memory Scope ───────────────────────────────────────────────

/**
 * Controls the visibility of a memory entry.
 * - `'agent'`: scoped to a specific agent (requires `agentId`). Default.
 * - `'project'`: visible to every agent in the project (shared knowledge).
 */
export type MemoryScope = 'agent' | 'project';

// ─── Memory Entry ───────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  projectId: ProjectId;
  /** Agent that owns this memory. Null when scope is 'project'. */
  agentId?: AgentId;
  sessionId?: SessionId;
  /** Visibility scope. Defaults to 'agent' when omitted. */
  scope?: MemoryScope;
  category: MemoryCategory;
  content: string;
  embedding: number[];
  /** Importance score from 0.0 to 1.0, assigned by the LLM at storage time. */
  importance: number;
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

// ─── Memory Retrieval ───────────────────────────────────────────

export interface MemoryRetrieval {
  query: string;
  topK: number;
  minImportance?: number;
  categories?: MemoryCategory[];
  /** If provided, search only within this session. Null = project-wide. */
  sessionScope?: SessionId;
  /**
   * Memory scope filter.
   * - `'agent'`: only return memories owned by `agentId` (requires `agentId`).
   * - `'project'`: return all memories for the project, crossing all agents.
   * - `undefined`: return both agent-scoped and project-scoped memories.
   */
  scope?: MemoryScope;
  /** Required when scope is 'agent'. Limits results to this agent's memories. */
  agentId?: AgentId;
  /**
   * Half-life in days for temporal decay scoring.
   * When set, the similarity score is multiplied by EXP(-λ * age_days)
   * so recent memories rank higher. Omit to use flat cosine similarity.
   */
  decayHalfLifeDays?: number;
}

export interface RetrievedMemory extends MemoryEntry {
  similarityScore: number;
}

// ─── Compaction Entry ───────────────────────────────────────────

export interface CompactionEntry {
  sessionId: SessionId;
  summary: string;
  messagesCompacted: number;
  tokensRecovered: number;
  createdAt: Date;
}
