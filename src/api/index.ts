// REST + WebSocket endpoints (Fastify)
export type {
  ApiError,
  ApiResponse,
  ChatRequest,
  ChatResponse,
  PaginatedResponse,
  PaginationParams,
  RouteDependencies,
} from './types.js';

export { registerErrorHandler, sendSuccess, sendError, sendNotFound } from './error-handler.js';
export { registerRoutes } from './routes/index.js';
