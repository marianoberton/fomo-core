/**
 * AgentTemplate repository — global catalog of agent archetypes.
 *
 * Read endpoints (list, findBySlug) back the public catalog. Write endpoints
 * (create, update, delete) back the "convert agent into template" + template
 * editor flows in the dashboard.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────────

export type AgentTemplateType = 'conversational' | 'process' | 'backoffice';

export interface AgentTemplatePromptConfig {
  identity: string;
  instructions: string;
  safety: string;
}

export interface AgentTemplateLlmConfig {
  provider: string;
  model: string;
  temperature?: number;
}

export interface AgentTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: AgentTemplateType;
  icon: string | null;
  tags: string[];
  isOfficial: boolean;
  promptConfig: AgentTemplatePromptConfig;
  suggestedTools: string[];
  suggestedLlm: AgentTemplateLlmConfig | null;
  suggestedModes: unknown[] | null;
  suggestedChannels: string[];
  suggestedMcps: unknown[] | null;
  suggestedSkillSlugs: string[];
  metadata: Record<string, unknown> | null;
  maxTurns: number;
  maxTokensPerTurn: number;
  budgetPerDayUsd: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTemplateFilters {
  type?: AgentTemplateType;
  tag?: string;
  q?: string;
  isOfficial?: boolean;
}

/** Input for creating a new AgentTemplate. */
export interface CreateAgentTemplateInput {
  slug: string;
  name: string;
  description: string;
  type: AgentTemplateType;
  icon?: string | null;
  tags?: string[];
  isOfficial?: boolean;
  promptConfig: AgentTemplatePromptConfig;
  suggestedTools?: string[];
  suggestedLlm?: AgentTemplateLlmConfig | null;
  suggestedModes?: unknown[] | null;
  suggestedChannels?: string[];
  suggestedMcps?: unknown[] | null;
  suggestedSkillSlugs?: string[];
  metadata?: Record<string, unknown> | null;
  maxTurns?: number;
  maxTokensPerTurn?: number;
  budgetPerDayUsd?: number;
}

/**
 * Input for updating an existing AgentTemplate.
 *
 * `slug` and `type` are intentionally NOT updatable — they are part of the
 * template's identity and changing them would silently break agents that
 * reference the template via `metadata.createdFromTemplate`.
 */
export interface UpdateAgentTemplateInput {
  name?: string;
  description?: string;
  icon?: string | null;
  tags?: string[];
  isOfficial?: boolean;
  promptConfig?: AgentTemplatePromptConfig;
  suggestedTools?: string[];
  suggestedLlm?: AgentTemplateLlmConfig | null;
  suggestedModes?: unknown[] | null;
  suggestedChannels?: string[];
  suggestedMcps?: unknown[] | null;
  suggestedSkillSlugs?: string[];
  metadata?: Record<string, unknown> | null;
  maxTurns?: number;
  maxTokensPerTurn?: number;
  budgetPerDayUsd?: number;
}

// ─── Repository ─────────────────────────────────────────────────

export interface AgentTemplateRepository {
  list(filters?: AgentTemplateFilters): Promise<AgentTemplate[]>;
  findBySlug(slug: string): Promise<AgentTemplate | null>;
  /** Create a new AgentTemplate. Throws on slug collision (P2002). */
  create(input: CreateAgentTemplateInput): Promise<AgentTemplate>;
  /** Update a template by slug. Returns null if no template with that slug exists. */
  update(slug: string, input: UpdateAgentTemplateInput): Promise<AgentTemplate | null>;
  /** Hard-delete a template by slug. Returns true on success, false if not found. */
  delete(slug: string): Promise<boolean>;
}

/** Map a Prisma AgentTemplate record to the app's domain type. */
function toAppModel(record: {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: AgentTemplateType;
  icon: string | null;
  tags: string[];
  isOfficial: boolean;
  promptConfig: Prisma.JsonValue;
  suggestedTools: string[];
  suggestedLlm: Prisma.JsonValue | null;
  suggestedModes: Prisma.JsonValue | null;
  suggestedChannels: string[];
  suggestedMcps: Prisma.JsonValue | null;
  suggestedSkillSlugs: string[];
  metadata: Prisma.JsonValue | null;
  maxTurns: number;
  maxTokensPerTurn: number;
  budgetPerDayUsd: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): AgentTemplate {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    type: record.type,
    icon: record.icon,
    tags: record.tags,
    isOfficial: record.isOfficial,
    promptConfig: record.promptConfig as unknown as AgentTemplatePromptConfig,
    suggestedTools: record.suggestedTools,
    suggestedLlm: record.suggestedLlm as unknown as AgentTemplateLlmConfig | null,
    suggestedModes: record.suggestedModes as unknown as unknown[] | null,
    suggestedChannels: record.suggestedChannels,
    suggestedMcps: record.suggestedMcps as unknown as unknown[] | null,
    suggestedSkillSlugs: record.suggestedSkillSlugs,
    metadata: record.metadata as unknown as Record<string, unknown> | null,
    maxTurns: record.maxTurns,
    maxTokensPerTurn: record.maxTokensPerTurn,
    budgetPerDayUsd: record.budgetPerDayUsd,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Create an AgentTemplateRepository backed by Prisma.
 */
export function createAgentTemplateRepository(
  prisma: PrismaClient,
): AgentTemplateRepository {
  return {
    async list(filters?: AgentTemplateFilters): Promise<AgentTemplate[]> {
      const where: Prisma.AgentTemplateWhereInput = {
        ...(filters?.type !== undefined && { type: filters.type }),
        ...(filters?.tag !== undefined && { tags: { has: filters.tag } }),
        ...(filters?.isOfficial !== undefined && { isOfficial: filters.isOfficial }),
        ...(filters?.q !== undefined &&
          filters.q.length > 0 && {
            OR: [
              { name: { contains: filters.q, mode: 'insensitive' } },
              { description: { contains: filters.q, mode: 'insensitive' } },
              { slug: { contains: filters.q, mode: 'insensitive' } },
            ],
          }),
      };

      const records = await prisma.agentTemplate.findMany({
        where,
        orderBy: [{ isOfficial: 'desc' }, { type: 'asc' }, { name: 'asc' }],
      });
      return records.map(toAppModel);
    },

    async findBySlug(slug: string): Promise<AgentTemplate | null> {
      const record = await prisma.agentTemplate.findUnique({ where: { slug } });
      if (!record) return null;
      return toAppModel(record);
    },

    async create(input: CreateAgentTemplateInput): Promise<AgentTemplate> {
      const record = await prisma.agentTemplate.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          type: input.type,
          icon: input.icon ?? null,
          tags: input.tags ?? [],
          isOfficial: input.isOfficial ?? false,
          promptConfig: input.promptConfig as unknown as Prisma.InputJsonValue,
          suggestedTools: input.suggestedTools ?? [],
          suggestedLlm:
            input.suggestedLlm === null || input.suggestedLlm === undefined
              ? Prisma.JsonNull
              : (input.suggestedLlm as unknown as Prisma.InputJsonValue),
          suggestedModes:
            input.suggestedModes === null || input.suggestedModes === undefined
              ? Prisma.JsonNull
              : (input.suggestedModes as unknown as Prisma.InputJsonValue),
          suggestedChannels: input.suggestedChannels ?? [],
          suggestedMcps:
            input.suggestedMcps === null || input.suggestedMcps === undefined
              ? Prisma.JsonNull
              : (input.suggestedMcps as unknown as Prisma.InputJsonValue),
          suggestedSkillSlugs: input.suggestedSkillSlugs ?? [],
          metadata:
            input.metadata === null || input.metadata === undefined
              ? Prisma.JsonNull
              : (input.metadata as unknown as Prisma.InputJsonValue),
          ...(input.maxTurns !== undefined && { maxTurns: input.maxTurns }),
          ...(input.maxTokensPerTurn !== undefined && {
            maxTokensPerTurn: input.maxTokensPerTurn,
          }),
          ...(input.budgetPerDayUsd !== undefined && {
            budgetPerDayUsd: input.budgetPerDayUsd,
          }),
        },
      });
      return toAppModel(record);
    },

    async update(
      slug: string,
      input: UpdateAgentTemplateInput,
    ): Promise<AgentTemplate | null> {
      const data: Prisma.AgentTemplateUpdateInput = {};

      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.icon !== undefined) data.icon = input.icon;
      if (input.tags !== undefined) data.tags = input.tags;
      if (input.isOfficial !== undefined) data.isOfficial = input.isOfficial;
      if (input.promptConfig !== undefined) {
        data.promptConfig = input.promptConfig as unknown as Prisma.InputJsonValue;
      }
      if (input.suggestedTools !== undefined) {
        data.suggestedTools = input.suggestedTools;
      }
      if (input.suggestedLlm !== undefined) {
        data.suggestedLlm =
          input.suggestedLlm === null
            ? Prisma.JsonNull
            : (input.suggestedLlm as unknown as Prisma.InputJsonValue);
      }
      if (input.suggestedModes !== undefined) {
        data.suggestedModes =
          input.suggestedModes === null
            ? Prisma.JsonNull
            : (input.suggestedModes as unknown as Prisma.InputJsonValue);
      }
      if (input.suggestedChannels !== undefined) {
        data.suggestedChannels = input.suggestedChannels;
      }
      if (input.suggestedMcps !== undefined) {
        data.suggestedMcps =
          input.suggestedMcps === null
            ? Prisma.JsonNull
            : (input.suggestedMcps as unknown as Prisma.InputJsonValue);
      }
      if (input.suggestedSkillSlugs !== undefined) {
        data.suggestedSkillSlugs = input.suggestedSkillSlugs;
      }
      if (input.metadata !== undefined) {
        data.metadata =
          input.metadata === null
            ? Prisma.JsonNull
            : (input.metadata as unknown as Prisma.InputJsonValue);
      }
      if (input.maxTurns !== undefined) data.maxTurns = input.maxTurns;
      if (input.maxTokensPerTurn !== undefined) {
        data.maxTokensPerTurn = input.maxTokensPerTurn;
      }
      if (input.budgetPerDayUsd !== undefined) {
        data.budgetPerDayUsd = input.budgetPerDayUsd;
      }

      try {
        const record = await prisma.agentTemplate.update({
          where: { slug },
          data,
        });
        return toAppModel(record);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          return null;
        }
        throw error;
      }
    },

    async delete(slug: string): Promise<boolean> {
      try {
        await prisma.agentTemplate.delete({ where: { slug } });
        return true;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          return false;
        }
        throw error;
      }
    },
  };
}
