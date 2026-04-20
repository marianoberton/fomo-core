/**
 * Admin tools barrel export.
 *
 * All admin tools live in this directory and are re-exported here
 * for registration in main.ts.
 */

// Agent & project read-only tools
export {
  createAdminListProjectsTool,
  createAdminListAgentsTool,
  createAdminGetAgentTool,
} from './agents.js';
export type { AdminAgentToolOptions } from './agents.js';

// Prompt layer read-only tools
export {
  createAdminListPromptLayersTool,
  createAdminGetPromptLayerTool,
  createAdminDiffPromptLayersTool,
} from './prompts.js';
export type { AdminPromptToolOptions } from './prompts.js';

// Observability read-only tools
export {
  createAdminQueryTracesTool,
  createAdminGetTraceTool,
  createAdminGetCostReportTool,
  createAdminGetAgentHealthTool,
} from './observability.js';
export type { AdminObservabilityToolOptions } from './observability.js';

// Tool management read-only tools
export { createAdminListToolsTool } from './tools-management.js';
export type { AdminToolManagementOptions } from './tools-management.js';

// Model registry read-only tools
export { createAdminListModelsTool } from './models.js';

// Write tools (agents, projects, tool grants)
export {
  createAdminCreateAgentTool,
  createAdminUpdateAgentTool,
  createAdminSetAgentStatusTool,
  createAdminCreateProjectTool,
  createAdminUpdateProjectTool,
  createAdminGrantToolTool,
  createAdminRevokeToolTool,
  createAdminSetAgentModelTool,
} from './write-agents.js';
export type { AdminWriteAgentToolOptions } from './write-agents.js';

// Write tools (prompt layers)
export {
  createAdminCreatePromptLayerTool,
  createAdminActivatePromptLayerTool,
} from './write-prompts.js';
export type { AdminWritePromptToolOptions } from './write-prompts.js';

// Sandbox tools
export {
  createAdminSandboxRunTool,
  createAdminSandboxCompareTool,
  createAdminSandboxPromoteTool,
} from './sandbox.js';
export type { AdminSandboxToolOptions } from './sandbox.js';

// Destructive tools (all require approval)
export {
  createAdminDeleteAgentTool,
  createAdminDeleteProjectTool,
  createAdminIssueApiKeyTool,
  createAdminRevokeApiKeyTool,
} from './destructive.js';
export type { AdminDestructiveToolOptions } from './destructive.js';

// Provisioning tools
export {
  createAdminGetProvisionStatusTool,
  createAdminProvisionClientTool,
  createAdminDeprovisionClientTool,
} from './provisioning.js';
export type { AdminProvisioningToolOptions } from './provisioning.js';
