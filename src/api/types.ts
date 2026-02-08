import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { PromptLayerRepository } from '@/infrastructure/repositories/prompt-layer-repository.js';
import type { ExecutionTraceRepository } from '@/infrastructure/repositories/execution-trace-repository.js';
import type { ScheduledTaskRepository } from '@/infrastructure/repositories/scheduled-task-repository.js';
import type { ApprovalGate } from '@/security/approval-gate.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { TaskManager } from '@/scheduling/task-manager.js';
import type { Logger } from '@/observability/logger.js';
import type { ContactRepository } from '@/contacts/types.js';
import type { ChannelRouter } from '@/channels/channel-router.js';
import type { InboundProcessor } from '@/channels/inbound-processor.js';

// ─── API Response Envelope ───────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Pagination ─────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ─── Chat Request/Response ──────────────────────────────────────

export interface ChatRequest {
  projectId: string;
  sessionId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  sessionId: string;
  traceId: string;
  response: string;
  toolCalls: {
    toolId: string;
    input: Record<string, unknown>;
    result: unknown;
  }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  };
}

// ─── Route Dependencies (DI) ───────────────────────────────────

/** Dependencies injected into all route plugins via Fastify register options. */
export interface RouteDependencies {
  projectRepository: ProjectRepository;
  sessionRepository: SessionRepository;
  promptLayerRepository: PromptLayerRepository;
  executionTraceRepository: ExecutionTraceRepository;
  scheduledTaskRepository: ScheduledTaskRepository;
  contactRepository: ContactRepository;
  approvalGate: ApprovalGate;
  toolRegistry: ToolRegistry;
  taskManager: TaskManager;
  channelRouter: ChannelRouter;
  inboundProcessor: InboundProcessor;
  logger: Logger;
}
