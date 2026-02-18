/**
 * Knowledge base types — CRUD management API for per-project memory entries.
 * Wraps the memory_entries table with a simpler, UI-friendly interface.
 */
import type { MemoryCategory } from '@/memory/types.js';

// ─── Knowledge Entry ────────────────────────────────────────────

/** A knowledge base entry as returned by the API (no embedding vector). */
export interface KnowledgeEntry {
  id: string;
  projectId: string;
  category: MemoryCategory;
  content: string;
  importance: number;
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

// ─── List Params ────────────────────────────────────────────────

export interface ListKnowledgeParams {
  projectId: string;
  page?: number;
  limit?: number;
  category?: MemoryCategory;
}

// ─── Bulk Import ─────────────────────────────────────────────────

export interface BulkImportItem {
  content: string;
  category?: MemoryCategory;
  importance?: number;
  metadata?: Record<string, unknown>;
}

// ─── Service Interface ──────────────────────────────────────────

/** Service for managing knowledge base entries (UI-facing CRUD). */
export interface KnowledgeService {
  /**
   * Add a knowledge entry. Generates an embedding if the embedding generator
   * is configured; otherwise stores as text-only (no semantic search).
   */
  add(params: {
    projectId: string;
    content: string;
    category?: MemoryCategory;
    importance?: number;
    metadata?: Record<string, unknown>;
  }): Promise<KnowledgeEntry>;

  /**
   * List knowledge entries with pagination and optional category filter.
   * Embeddings are NOT returned.
   */
  list(params: ListKnowledgeParams): Promise<{
    entries: KnowledgeEntry[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }>;

  /** Delete a knowledge entry by ID. Returns true if deleted, false if not found. */
  delete(id: string): Promise<boolean>;

  /**
   * Bulk import knowledge entries.
   * Processes in batches of 20 to avoid overloading the embedding API.
   */
  bulkImport(params: {
    projectId: string;
    items: BulkImportItem[];
  }): Promise<{ imported: number; failed: number; errors: string[] }>;
}
