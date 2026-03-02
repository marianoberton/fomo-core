/**
 * Skill Service
 *
 * Business logic for skill management and composition.
 * Skills compose transparently into the agent's prompt and tool allowlist at chat time.
 */
import { createLogger } from '@/observability/logger.js';
import type {
  SkillRepository,
  SkillTemplate,
  SkillInstance,
  SkillCategory,
  SkillComposition,
  CreateSkillInstanceInput,
  UpdateSkillInstanceInput,
} from './types.js';

const logger = createLogger({ name: 'skill-service' });

// ─── Service Interface ──────────────────────────────────────

/** Skill service for template browsing, instance management, and composition. */
export interface SkillService {
  /** List all published skill templates, optionally filtered by category. */
  listTemplates(category?: SkillCategory): Promise<SkillTemplate[]>;
  /** Get a single skill template by ID. */
  getTemplate(id: string): Promise<SkillTemplate | null>;

  /** List all skill instances for a project. */
  listInstances(projectId: string): Promise<SkillInstance[]>;
  /** Get a single skill instance by ID. */
  getInstance(id: string): Promise<SkillInstance | null>;
  /** Create a skill instance (from template or custom). */
  createInstance(input: CreateSkillInstanceInput): Promise<SkillInstance>;
  /** Create a skill instance from a template, merging template defaults with overrides. */
  createFromTemplate(projectId: string, templateId: string, overrides?: {
    name?: string;
    displayName?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }): Promise<SkillInstance>;
  /** Update a skill instance. */
  updateInstance(id: string, input: UpdateSkillInstanceInput): Promise<SkillInstance>;
  /** Delete a skill instance. */
  deleteInstance(id: string): Promise<void>;

  /** Compose all active skills assigned to an agent into merged instructions + tools + MCP. */
  composeForAgent(skillIds: string[]): Promise<SkillComposition>;
}

// ─── Service Options ────────────────────────────────────────

export interface SkillServiceOptions {
  repository: SkillRepository;
}

// ─── Factory ────────────────────────────────────────────────

/**
 * Creates a SkillService.
 */
export function createSkillService(options: SkillServiceOptions): SkillService {
  const { repository } = options;

  return {
    async listTemplates(category?: SkillCategory): Promise<SkillTemplate[]> {
      return await repository.listTemplates(category);
    },

    async getTemplate(id: string): Promise<SkillTemplate | null> {
      return await repository.getTemplate(id);
    },

    async listInstances(projectId: string): Promise<SkillInstance[]> {
      return await repository.listInstances(projectId);
    },

    async getInstance(id: string): Promise<SkillInstance | null> {
      return await repository.getInstance(id);
    },

    async createInstance(input: CreateSkillInstanceInput): Promise<SkillInstance> {
      logger.info('Creating skill instance', {
        component: 'skill-service',
        projectId: input.projectId,
        name: input.name,
        templateId: input.templateId,
      });
      return await repository.createInstance(input);
    },

    async createFromTemplate(projectId: string, templateId: string, overrides?: {
      name?: string;
      displayName?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }): Promise<SkillInstance> {
      const template = await repository.getTemplate(templateId);
      if (!template) {
        throw new Error(`Skill template not found: ${templateId}`);
      }

      logger.info('Creating skill instance from template', {
        component: 'skill-service',
        projectId,
        templateId,
        templateName: template.name,
      });

      // Resolve parameters into instructions fragment via simple {{param}} substitution
      let resolvedInstructions = template.instructionsFragment;
      if (overrides?.parameters) {
        for (const [key, value] of Object.entries(overrides.parameters)) {
          const placeholder = `{{${key}}}`;
          resolvedInstructions = resolvedInstructions.split(placeholder).join(String(value));
        }
      }

      return await repository.createInstance({
        projectId,
        templateId,
        name: overrides?.name ?? template.name,
        displayName: overrides?.displayName ?? template.displayName,
        description: overrides?.description ?? template.description,
        instructionsFragment: resolvedInstructions,
        requiredTools: template.requiredTools,
        requiredMcpServers: template.requiredMcpServers,
        parameters: overrides?.parameters,
      });
    },

    async updateInstance(id: string, input: UpdateSkillInstanceInput): Promise<SkillInstance> {
      logger.info('Updating skill instance', { component: 'skill-service', instanceId: id });
      return await repository.updateInstance(id, input);
    },

    async deleteInstance(id: string): Promise<void> {
      logger.info('Deleting skill instance', { component: 'skill-service', instanceId: id });
      await repository.deleteInstance(id);
    },

    async composeForAgent(skillIds: string[]): Promise<SkillComposition> {
      if (skillIds.length === 0) {
        return { mergedInstructions: '', mergedTools: [], mergedMcpServers: [] };
      }

      const instances = await repository.getInstancesByIds(skillIds);

      // Filter to only active instances
      const active = instances.filter((i) => i.status === 'active');

      if (active.length === 0) {
        return { mergedInstructions: '', mergedTools: [], mergedMcpServers: [] };
      }

      // Preserve order from skillIds (agent's assignment order matters)
      const ordered = skillIds
        .map((id) => active.find((i) => i.id === id))
        .filter((i): i is SkillInstance => i !== undefined);

      // Compose instructions with section headers
      const fragments = ordered.map(
        (skill) => `## ${skill.displayName}\n\n${skill.instructionsFragment}`,
      );
      const mergedInstructions = fragments.join('\n\n---\n\n');

      // Union tool IDs (deduplicated)
      const toolSet = new Set<string>();
      for (const skill of ordered) {
        for (const tool of skill.requiredTools) {
          toolSet.add(tool);
        }
      }

      // Union MCP server names (deduplicated)
      const mcpSet = new Set<string>();
      for (const skill of ordered) {
        for (const mcp of skill.requiredMcpServers) {
          mcpSet.add(mcp);
        }
      }

      logger.info('Skills composed for agent', {
        component: 'skill-service',
        skillCount: ordered.length,
        toolCount: toolSet.size,
        mcpCount: mcpSet.size,
      });

      return {
        mergedInstructions,
        mergedTools: [...toolSet],
        mergedMcpServers: [...mcpSet],
      };
    },
  };
}
