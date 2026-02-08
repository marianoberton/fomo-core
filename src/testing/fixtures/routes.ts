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
import type { ApprovalGate } from '@/security/approval-gate.js';
import type { ToolRegistry } from '@/tools/registry/tool-registry.js';
import type { TaskManager } from '@/scheduling/task-manager.js';
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
  approvalGate: ReturnType<typeof createMockApprovalGate>;
  toolRegistry: ReturnType<typeof createMockToolRegistry>;
  taskManager: ReturnType<typeof createMockTaskManager>;
} {
  return {
    projectRepository: createMockProjectRepository(),
    sessionRepository: createMockSessionRepository(),
    promptLayerRepository: createMockPromptLayerRepository(),
    executionTraceRepository: createMockExecutionTraceRepository(),
    scheduledTaskRepository: createMockScheduledTaskRepository(),
    approvalGate: createMockApprovalGate(),
    toolRegistry: createMockToolRegistry(),
    taskManager: createMockTaskManager(),
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
