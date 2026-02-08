// ─── Types ──────────────────────────────────────────────────────
export type { ProjectConfig } from './types.js';
export type { ProjectConfigFile } from './loader.js';

// ─── Schemas ────────────────────────────────────────────────────
export {
  agentConfigSchema,
  costConfigSchema,
  failoverConfigSchema,
  llmProviderConfigSchema,
  memoryConfigSchema,
  projectConfigFileSchema,
} from './schema.js';

// ─── Loader ─────────────────────────────────────────────────────
export { ConfigError, loadProjectConfig, resolveEnvVars } from './loader.js';
