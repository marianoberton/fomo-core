/**
 * Base error class for all Nexus Core errors.
 * Extends Error with a machine-readable code, HTTP status, and structured context.
 */
export class NexusError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(params: {
    message: string;
    code: string;
    statusCode?: number;
    cause?: Error;
    context?: Record<string, unknown>;
    isOperational?: boolean;
  }) {
    super(params.message, { cause: params.cause });
    this.name = 'NexusError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.context = params.context;
    this.isOperational = params.isOperational ?? true;
  }
}

/** Thrown when a project exceeds its daily or monthly LLM budget. */
export class BudgetExceededError extends NexusError {
  constructor(projectId: string, budgetType: 'daily' | 'monthly', current: number, limit: number) {
    super({
      message: `${budgetType} budget exceeded for project ${projectId}: $${current.toFixed(2)}/$${limit.toFixed(2)}`,
      code: 'BUDGET_EXCEEDED',
      statusCode: 429,
      context: { projectId, budgetType, current, limit },
    });
    this.name = 'BudgetExceededError';
  }
}

/** Thrown when the agent tries to use a tool not in the project's whitelist. */
export class ToolNotAllowedError extends NexusError {
  constructor(toolId: string, projectId: string) {
    super({
      message: `Tool "${toolId}" is not in the allowed list for project "${projectId}"`,
      code: 'TOOL_NOT_ALLOWED',
      statusCode: 403,
      context: { toolId, projectId },
    });
    this.name = 'ToolNotAllowedError';
  }
}

/** Thrown when the LLM requests a tool that does not exist in the registry. */
export class ToolHallucinationError extends NexusError {
  constructor(toolId: string, availableTools: string[]) {
    super({
      message: `LLM requested non-existent tool "${toolId}"`,
      code: 'TOOL_HALLUCINATION',
      statusCode: 400,
      context: { toolId, availableTools },
    });
    this.name = 'ToolHallucinationError';
  }
}

/** Thrown when a tool requires human approval before execution. */
export class ApprovalRequiredError extends NexusError {
  constructor(toolId: string, approvalId: string) {
    super({
      message: `Tool "${toolId}" requires human approval (${approvalId})`,
      code: 'APPROVAL_REQUIRED',
      statusCode: 202,
      context: { toolId, approvalId },
    });
    this.name = 'ApprovalRequiredError';
  }
}

/** Thrown when an LLM provider call fails. */
export class ProviderError extends NexusError {
  constructor(provider: string, message: string, cause?: Error) {
    super({
      message: `LLM provider "${provider}" error: ${message}`,
      code: 'PROVIDER_ERROR',
      statusCode: 502,
      cause,
      context: { provider },
    });
    this.name = 'ProviderError';
  }
}

/** Thrown when input validation (Zod) fails. */
export class ValidationError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      context,
    });
    this.name = 'ValidationError';
  }
}

/** Thrown when a session-level error occurs (max turns, expired, etc.). */
export class SessionError extends NexusError {
  constructor(message: string, sessionId: string) {
    super({
      message,
      code: 'SESSION_ERROR',
      statusCode: 400,
      context: { sessionId },
    });
    this.name = 'SessionError';
  }
}

/** Thrown when rate limits are exceeded. */
export class RateLimitError extends NexusError {
  constructor(projectId: string, limitType: 'rpm' | 'rph', current: number, limit: number) {
    super({
      message: `Rate limit (${limitType}) exceeded for project ${projectId}: ${current}/${limit}`,
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
      context: { projectId, limitType, current, limit },
    });
    this.name = 'RateLimitError';
  }
}

/** Thrown when a tool's execute() or dryRun() fails at runtime. */
export class ToolExecutionError extends NexusError {
  constructor(toolId: string, message: string, cause?: Error) {
    super({
      message: `Tool "${toolId}" execution failed: ${message}`,
      code: 'TOOL_EXECUTION_ERROR',
      statusCode: 500,
      cause,
      context: { toolId },
    });
    this.name = 'ToolExecutionError';
  }
}
