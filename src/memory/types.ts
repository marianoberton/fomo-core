import type { ProjectId, SessionId } from '@/core/types.js';

// ─── Memory Categories ──────────────────────────────────────────

export type MemoryCategory = 'fact' | 'decision' | 'preference' | 'task_context' | 'learning';

// ─── Memory Entry ───────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  projectId: ProjectId;
  sessionId?: SessionId;
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
