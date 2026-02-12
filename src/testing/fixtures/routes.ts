/**
 * Factory for creating mock RouteDependencies used in route tests.
 * Every repository method is a vi.fn() so tests can stub specific behaviors.
 */
import { vi } from 'vitest';
import type { RouteDependencies } from '@/api/types.js';
import type { ProjectRepository, Project } from '@/infrastructure/repositories/project-repository.js';
import type { SessionRepository, Session, StoredMessage } from '@/infrastructure/repositories/session-repository.js';
import type { PromptLayerRepository } from '@/infrastructure/repositories/prompt-layer-repository.js';
import type { ExecutionTraceRepository } from '@/infrastructure/repositories/execution-trace-repository.js';
import type { ScheduledTaskRepository } from '@/infrastructure/repositories/scheduled-task-repository.js';
import type { ContactRepository } from '@/contacts/types.js';
import type { WebhookRepository } from '@/webhooks/types.js';
import type { FileRepository } from '@/files/types.js';
import type { AgentRepository, AgentRegistry, AgentComms } from '@/agents/types.js';
import type { ApprovalGate } from '@/security/approval-gate.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { TaskManager } from '@/scheduling/task-manager.js';
import type { MCPManager } from '@/mcp/mcp-manager.js';
import type { ChannelRouter } from '@/channels/channel-router.js';
import type { InboundProcessor } from '@/channels/inbound-processor.js';
import type { WebhookProcessor } from '@/webhooks/webhook-processor.js';
import type { FileService } from '@/files/file-service.js';
import type { Logger } from '@/observability/logger.js';
import type {
  ExecutionTrace,
  ProjectId,
  PromptLayerId,
  PromptSnapshot,
  ScheduledTaskId,
  SessionId,
  TraceId,
} from '@/core/types.js';
import type { PromptLayer } from '@/prompts/types.js';
import type { ScheduledTask } from '@/scheduling/types.js';
import { createTestAgentConfig } from './context.js';

// ─── Mock Factories ─────────────────────────────────────────────

/** Create a mock ProjectRepository with all methods as vi.fn(). */
export function createMockProjectRepository(): {
  [K in keyof ProjectRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };
}

/** Create a mock SessionRepository with all methods as vi.fn(). */
export function createMockSessionRepository(): {
  [K in keyof SessionRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    listByProject: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn(),
  };
}

/** Create a mock PromptLayerRepository with all methods as vi.fn(). */
export function createMockPromptLayerRepository(): {
  [K in keyof PromptLayerRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    getActiveLayer: vi.fn(),
    activate: vi.fn(),
    listByProject: vi.fn(),
  };
}

/** Create a mock ExecutionTraceRepository with all methods as vi.fn(). */
export function createMockExecutionTraceRepository(): {
  [K in keyof ExecutionTraceRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    addEvents: vi.fn(),
    listBySession: vi.fn(),
  };
}

/** Create a mock ApprovalGate with all methods as vi.fn(). */
export function createMockApprovalGate(): {
  [K in keyof ApprovalGate]: ReturnType<typeof vi.fn>;
} {
  return {
    requestApproval: vi.fn(),
    resolve: vi.fn(),
    get: vi.fn(),
    listPending: vi.fn(),
    listAll: vi.fn().mockResolvedValue([]),
    isApproved: vi.fn(),
  };
}

/** Create a mock ToolRegistry with all methods as vi.fn(). */
export function createMockToolRegistry(): {
  [K in keyof ToolRegistry]: ReturnType<typeof vi.fn>;
} {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    listAll: vi.fn().mockReturnValue([]),
    listForContext: vi.fn().mockReturnValue([]),
    formatForProvider: vi.fn().mockReturnValue([]),
    resolve: vi.fn(),
    resolveDryRun: vi.fn(),
  };
}

/** Create a mock ScheduledTaskRepository with all methods as vi.fn(). */
export function createMockScheduledTaskRepository(): {
  [K in keyof ScheduledTaskRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    listByProject: vi.fn(),
    getTasksDueForExecution: vi.fn(),
    createRun: vi.fn(),
    updateRun: vi.fn(),
    listRuns: vi.fn(),
  };
}

/** Create a mock TaskManager with all methods as vi.fn(). */
export function createMockTaskManager(): {
  [K in keyof TaskManager]: ReturnType<typeof vi.fn>;
} {
  return {
    createTask: vi.fn(),
    proposeTask: vi.fn(),
    approveTask: vi.fn(),
    rejectTask: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(),
    listRuns: vi.fn(),
    validateCron: vi.fn(),
  };
}

/** Create a mock MCPManager with all methods as vi.fn(). */
export function createMockMCPManager(): {
  [K in keyof MCPManager]: ReturnType<typeof vi.fn>;
} {
  return {
    connectAll: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
    getConnection: vi.fn().mockReturnValue(undefined),
    listConnections: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    getToolSchemas: vi.fn().mockReturnValue(new Map()),
  };
}

/** Create a mock ContactRepository with all methods as vi.fn(). */
export function createMockContactRepository(): {
  [K in keyof ContactRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByChannel: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };
}

/** Create a mock WebhookRepository with all methods as vi.fn(). */
export function createMockWebhookRepository(): {
  [K in keyof WebhookRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn(),
  };
}

/** Create a mock FileRepository with all methods as vi.fn(). */
export function createMockFileRepository(): {
  [K in keyof FileRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByProject: vi.fn(),
    delete: vi.fn(),
    updateMetadata: vi.fn(),
  };
}

/** Create a mock AgentRepository with all methods as vi.fn(). */
export function createMockAgentRepository(): {
  [K in keyof AgentRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn(),
    listAll: vi.fn(),
  };
}

/** Create a mock ChannelRouter with all methods as vi.fn(). */
export function createMockChannelRouter(): {
  [K in keyof ChannelRouter]: ReturnType<typeof vi.fn>;
} {
  return {
    registerAdapter: vi.fn(),
    getAdapter: vi.fn(),
    send: vi.fn(),
    parseInbound: vi.fn(),
    listChannels: vi.fn().mockReturnValue([]),
    isHealthy: vi.fn().mockReturnValue(true),
  };
}

/** Create a mock InboundProcessor with all methods as vi.fn(). */
export function createMockInboundProcessor(): {
  [K in keyof InboundProcessor]: ReturnType<typeof vi.fn>;
} {
  return {
    process: vi.fn(),
  };
}

/** Create a mock WebhookProcessor with all methods as vi.fn(). */
export function createMockWebhookProcessor(): {
  [K in keyof WebhookProcessor]: ReturnType<typeof vi.fn>;
} {
  return {
    process: vi.fn(),
    validateSignature: vi.fn(),
  };
}

/** Create a mock FileService with all methods as vi.fn(). */
export function createMockFileService(): {
  [K in keyof FileService]: ReturnType<typeof vi.fn>;
} {
  return {
    upload: vi.fn(),
    download: vi.fn(),
    getById: vi.fn(),
    delete: vi.fn(),
    getTemporaryUrl: vi.fn(),
  };
}

/** Create a mock AgentRegistry with all methods as vi.fn(). */
export function createMockAgentRegistry(): {
  [K in keyof AgentRegistry]: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(),
    getByName: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    refresh: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn(),
  };
}

/** Create a mock AgentComms with all methods as vi.fn(). */
export function createMockAgentComms(): {
  [K in keyof AgentComms]: ReturnType<typeof vi.fn>;
} {
  return {
    send: vi.fn(),
    sendAndWait: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => undefined),
  };
}

/** Create a silent mock Logger. */
export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

/** Assemble a complete RouteDependencies with all mocks. */
export function createMockDeps(): RouteDependencies & {
  projectRepository: ReturnType<typeof createMockProjectRepository>;
  sessionRepository: ReturnType<typeof createMockSessionRepository>;
  promptLayerRepository: ReturnType<typeof createMockPromptLayerRepository>;
  executionTraceRepository: ReturnType<typeof createMockExecutionTraceRepository>;
  scheduledTaskRepository: ReturnType<typeof createMockScheduledTaskRepository>;
  contactRepository: ReturnType<typeof createMockContactRepository>;
  webhookRepository: ReturnType<typeof createMockWebhookRepository>;
  fileRepository: ReturnType<typeof createMockFileRepository>;
  agentRepository: ReturnType<typeof createMockAgentRepository>;
  approvalGate: ReturnType<typeof createMockApprovalGate>;
  toolRegistry: ReturnType<typeof createMockToolRegistry>;
  taskManager: ReturnType<typeof createMockTaskManager>;
  mcpManager: ReturnType<typeof createMockMCPManager>;
  channelRouter: ReturnType<typeof createMockChannelRouter>;
  inboundProcessor: ReturnType<typeof createMockInboundProcessor>;
  webhookProcessor: ReturnType<typeof createMockWebhookProcessor>;
  fileService: ReturnType<typeof createMockFileService>;
  agentRegistry: ReturnType<typeof createMockAgentRegistry>;
  agentComms: ReturnType<typeof createMockAgentComms>;
} {
  return {
    projectRepository: createMockProjectRepository(),
    sessionRepository: createMockSessionRepository(),
    promptLayerRepository: createMockPromptLayerRepository(),
    executionTraceRepository: createMockExecutionTraceRepository(),
    scheduledTaskRepository: createMockScheduledTaskRepository(),
    contactRepository: createMockContactRepository(),
    webhookRepository: createMockWebhookRepository(),
    fileRepository: createMockFileRepository(),
    agentRepository: createMockAgentRepository(),
    approvalGate: createMockApprovalGate(),
    toolRegistry: createMockToolRegistry(),
    taskManager: createMockTaskManager(),
    mcpManager: createMockMCPManager(),
    channelRouter: createMockChannelRouter(),
    inboundProcessor: createMockInboundProcessor(),
    webhookProcessor: createMockWebhookProcessor(),
    fileService: createMockFileService(),
    agentRegistry: createMockAgentRegistry(),
    agentComms: createMockAgentComms(),
    longTermMemoryStore: null,
    logger: createMockLogger(),
  };
}

// ─── Sample Data Factories ──────────────────────────────────────

/** Create a sample Project for tests. */
export function createSampleProject(overrides?: Partial<Project>): Project {
  return {
    id: 'proj-1' as ProjectId,
    name: 'Test Project',
    description: 'A test project',
    environment: 'development',
    owner: 'test-user',
    tags: ['test'],
    config: createTestAgentConfig(),
    status: 'active',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/** Create a sample Session for tests. */
export function createSampleSession(overrides?: Partial<Session>): Session {
  return {
    id: 'sess-1' as SessionId,
    projectId: 'proj-1' as ProjectId,
    status: 'active',
    metadata: {},
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/** Create a sample StoredMessage for tests. */
export function createSampleMessage(overrides?: Partial<StoredMessage>): StoredMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1' as SessionId,
    role: 'user',
    content: 'Hello',
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/** Create a sample PromptLayer for tests. */
export function createSamplePromptLayer(overrides?: Partial<PromptLayer>): PromptLayer {
  return {
    id: 'pl-identity-1' as PromptLayerId,
    projectId: 'proj-1' as ProjectId,
    layerType: 'identity',
    version: 1,
    content: 'You are a helpful assistant.',
    isActive: true,
    createdAt: new Date('2025-01-01'),
    createdBy: 'test-user',
    changeReason: 'Initial version',
    ...overrides,
  };
}

/** Create a sample PromptSnapshot for tests. */
export function createSamplePromptSnapshot(overrides?: Partial<PromptSnapshot>): PromptSnapshot {
  return {
    identityLayerId: 'pl-identity-1' as PromptLayerId,
    identityVersion: 1,
    instructionsLayerId: 'pl-instructions-1' as PromptLayerId,
    instructionsVersion: 1,
    safetyLayerId: 'pl-safety-1' as PromptLayerId,
    safetyVersion: 1,
    toolDocsHash: 'abc123',
    runtimeContextHash: 'def456',
    ...overrides,
  };
}

/** Create a sample ExecutionTrace for tests. */
export function createSampleTrace(overrides?: Partial<ExecutionTrace>): ExecutionTrace {
  return {
    id: 'trace-1' as TraceId,
    projectId: 'proj-1' as ProjectId,
    sessionId: 'sess-1' as SessionId,
    promptSnapshot: createSamplePromptSnapshot(),
    events: [],
    totalDurationMs: 1500,
    totalTokensUsed: 500,
    totalCostUSD: 0.01,
    turnCount: 1,
    status: 'completed',
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/** Create a sample ScheduledTask for tests. */
export function createSampleScheduledTask(overrides?: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 'task-1' as ScheduledTaskId,
    projectId: 'proj-1' as ProjectId,
    name: 'Daily Report',
    description: 'Generate daily summary report',
    cronExpression: '0 9 * * *',
    taskPayload: { message: 'Generate the daily report' },
    origin: 'static',
    status: 'active',
    maxRetries: 2,
    timeoutMs: 300_000,
    budgetPerRunUSD: 1.0,
    maxDurationMinutes: 30,
    maxTurns: 10,
    runCount: 0,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/** Create a sample AgentConfig for tests. */
export { createTestAgentConfig };
