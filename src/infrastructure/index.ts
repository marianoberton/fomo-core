// Database client singleton
export { createDatabase, getDatabase, resetDatabaseSingleton } from './database.js';
export type { Database, DatabaseOptions } from './database.js';

// Repositories
export {
  createProjectRepository,
  createSessionRepository,
  createPromptLayerRepository,
  createExecutionTraceRepository,
  createScheduledTaskRepository,
} from './repositories/index.js';

export type {
  Project, ProjectCreateInput, ProjectUpdateInput, ProjectFilters, ProjectRepository,
  Session, SessionCreateInput, StoredMessage, SessionRepository,
  PromptLayerCreateInput, PromptLayerRepository,
  TraceCreateInput, TraceUpdateInput, ExecutionTraceRepository,
  ScheduledTaskRepository, ScheduledTaskUpdateInput, ScheduledTaskRunUpdateInput,
} from './repositories/index.js';
