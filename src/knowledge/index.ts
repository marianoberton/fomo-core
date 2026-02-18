/**
 * Knowledge base module — per-project CRUD for memory entries.
 */
export type {
  KnowledgeEntry,
  KnowledgeService,
  ListKnowledgeParams,
  BulkImportItem,
} from './types.js';

export { createKnowledgeService } from './knowledge-service.js';
export type { KnowledgeServiceOptions } from './knowledge-service.js';
