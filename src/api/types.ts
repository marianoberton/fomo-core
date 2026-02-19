import type { PrismaClient } from '@prisma/client';
import type { ProjectRepository } from '@/infrastructure/repositories/project-repository.js';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { PromptLayerRepository } from '@/infrastructure/repositories/prompt-layer-repository.js';
import type { ExecutionTraceRepository } from '@/infrastructure/repositories/execution-trace-repository.js';
import type { ScheduledTaskRepository } from '@/infrastructure/repositories/scheduled-task-repository.js';
import type { ApprovalGate } from '@/security/approval-gate.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { TaskManager } from '@/scheduling/task-manager.js';
import type { MCPManager } from '@/mcp/mcp-manager.js';
import type { Logger } from '@/observability/logger.js';
import type { ContactRepository } from '@/contacts/types.js';
import type { InboundProcessor } from '@/channels/inbound-processor.js';
import type { WebhookRepository } from '@/webhooks/types.js';
import type { WebhookProcessor } from '@/webhooks/webhook-processor.js';
import type { FileRepository } from '@/files/types.js';
import type { FileService } from '@/files/file-service.js';
import type { AgentRepository, AgentRegistry, AgentComms } from '@/agents/types.js';
import type { LongTermMemoryStore } from '@/memory/memory-manager.js';
import type { ProactiveMessenger } from '@/channels/proactive.js';
import type { SecretService } from '@/secrets/types.js';
import type { KnowledgeService } from '@/knowledge/types.js';
import type { ChannelResolver } from '@/channels/channel-resolver.js';
import type { ChannelIntegrationRepository } from '@/channels/types.js';

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
  webhookRepository: WebhookRepository;
  fileRepository: FileRepository;
  agentRepository: AgentRepository;
  approvalGate: ApprovalGate;
  toolRegistry: ToolRegistry;
  taskManager: TaskManager;
  mcpManager: MCPManager;
  inboundProcessor: InboundProcessor;
  webhookProcessor: WebhookProcessor;
  fileService: FileService;
  agentRegistry: AgentRegistry;
  agentComms: AgentComms;
  /** Proactive messenger for scheduled outbound messages (null if Redis not configured). */
  proactiveMessenger: ProactiveMessenger | null;
  /** Long-term memory store for pgvector semantic search (null if embeddings not configured). */
  longTermMemoryStore: LongTermMemoryStore | null;
  /** Encrypted per-project credential store. */
  secretService: SecretService;
  /** Knowledge base CRUD service (null if embeddings not configured). */
  knowledgeService: KnowledgeService | null;
  /** Per-project channel adapter resolver (secrets-based). */
  channelResolver: ChannelResolver;
  /** Channel integration repository for CRUD operations. */
  channelIntegrationRepository: ChannelIntegrationRepository;
  /** Prisma client for direct queries (dashboard aggregations). */
  prisma: PrismaClient;
  logger: Logger;
}
