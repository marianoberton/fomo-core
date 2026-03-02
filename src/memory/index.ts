// Memory manager — 4 layers (context window, pruning, compaction, long-term)
export type {
  CompactionEntry,
  MemoryCategory,
  MemoryEntry,
  MemoryRetrieval,
  MemoryScope,
  RetrievedMemory,
} from './types.js';

export { createMemoryManager } from './memory-manager.js';
export type {
  MemoryManager,
  MemoryManagerOptions,
  TokenCounter,
  CompactionSummarizer,
  LongTermMemoryStore,
} from './memory-manager.js';

export { createPrismaMemoryStore } from './prisma-memory-store.js';
export type { EmbeddingGenerator } from './prisma-memory-store.js';
