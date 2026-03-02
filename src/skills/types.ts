/**
 * Skill System Types
 *
 * Skills are composable capability packages (instructions + tools + MCP + parameters)
 * that can be assigned to agents. Layer 1 = always-active capabilities.
 */

// ─── Skill Template ──────────────────────────────────────────

/** Global skill template (reusable across projects). */
export interface SkillTemplate {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: SkillCategory;

  /** Instructions fragment appended to the agent's Instructions prompt layer. */
  instructionsFragment: string;
  /** Tool IDs this skill requires. */
  requiredTools: string[];
  /** MCP server names this skill requires (optional). */
  requiredMcpServers: string[];

  /** JSON Schema for customizable parameters (rendered as form in dashboard). */
  parametersSchema: Record<string, unknown> | null;

  tags: string[];
  /** Lucide icon name for dashboard display. */
  icon: string | null;
  isOfficial: boolean;
  version: number;
  status: SkillTemplateStatus;

  createdAt: Date;
  updatedAt: Date;
}

/** Per-project skill instance (created from template or custom). */
export interface SkillInstance {
  id: string;
  projectId: string;
  templateId: string | null;
  name: string;
  displayName: string;
  description: string | null;

  /** Instructions fragment (can override template). */
  instructionsFragment: string;
  /** Tool IDs (can override template). */
  requiredTools: string[];
  /** MCP server names (can override template). */
  requiredMcpServers: string[];

  /** Resolved parameter values (user-filled). */
  parameters: Record<string, unknown> | null;

  status: SkillInstanceStatus;

  createdAt: Date;
  updatedAt: Date;
}

// ─── Enums ──────────────────────────────────────────────────

export type SkillCategory = 'sales' | 'support' | 'operations' | 'communication';
export type SkillTemplateStatus = 'draft' | 'published' | 'deprecated';
export type SkillInstanceStatus = 'active' | 'disabled';

// ─── Composition Result ─────────────────────────────────────

/** Result of composing all skills assigned to an agent. */
export interface SkillComposition {
  /** Concatenated instructions fragments with section headers. */
  mergedInstructions: string;
  /** Union of all required tool IDs (deduplicated). */
  mergedTools: string[];
  /** Union of all required MCP server names (deduplicated). */
  mergedMcpServers: string[];
}

// ─── Inputs ─────────────────────────────────────────────────

/** Input for creating a skill instance. */
export interface CreateSkillInstanceInput {
  projectId: string;
  templateId?: string;
  name: string;
  displayName: string;
  description?: string;
  instructionsFragment: string;
  requiredTools?: string[];
  requiredMcpServers?: string[];
  parameters?: Record<string, unknown>;
}

/** Input for updating a skill instance. */
export interface UpdateSkillInstanceInput {
  name?: string;
  displayName?: string;
  description?: string;
  instructionsFragment?: string;
  requiredTools?: string[];
  requiredMcpServers?: string[];
  parameters?: Record<string, unknown>;
  status?: SkillInstanceStatus;
}

// ─── Repository Interface ───────────────────────────────────

/** Repository for skill template and instance CRUD. */
export interface SkillRepository {
  // Templates
  listTemplates(category?: SkillCategory): Promise<SkillTemplate[]>;
  getTemplate(id: string): Promise<SkillTemplate | null>;

  // Instances
  listInstances(projectId: string): Promise<SkillInstance[]>;
  getInstance(id: string): Promise<SkillInstance | null>;
  getInstancesByIds(ids: string[]): Promise<SkillInstance[]>;
  createInstance(input: CreateSkillInstanceInput): Promise<SkillInstance>;
  updateInstance(id: string, input: UpdateSkillInstanceInput): Promise<SkillInstance>;
  deleteInstance(id: string): Promise<void>;
}
