/**
 * Sandbox module — OpenClaw optimization sandbox exports.
 */
export { sandboxClientMessage } from './sandbox-schemas.js';
export type { SandboxClientMessage } from './sandbox-schemas.js';

export type {
  SandboxStreamEvent,
  RunMetrics,
  MetricsDiff,
  SandboxReadyEvent,
  ConfigUpdatedEvent,
  PromptUpdatedEvent,
  ComparisonEvent,
  PromotedEvent,
  SandboxHistoryEvent,
} from './sandbox-events.js';

export {
  createSandboxState,
  prepareSandboxRun,
  getEffectiveLayers,
  getEffectiveConfig,
  createDryRunToolRegistry,
  extractRunMetrics,
  computeMetricsDiff,
} from './sandbox-session.js';
export type { SandboxState, SandboxRunSetup, ConfigChangeEntry } from './sandbox-session.js';

export {
  buildSandboxBaseline,
  createSandboxRunner,
  SandboxBaselineError,
  SandboxRunnerError,
} from './sandbox-runner.js';
export type {
  SandboxRunner,
  SandboxRunnerDeps,
  SandboxBaseline,
  SandboxRunOverrides,
  SandboxRunRequest,
  SandboxRunResult,
} from './sandbox-runner.js';
