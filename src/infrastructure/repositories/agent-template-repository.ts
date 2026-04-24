/**
 * AgentTemplate repository — read-only access to the global catalog of agent
 * archetypes. Official templates are seeded; custom (non-official) CRUD is
 * planned for v2.
 */
import type { PrismaClient, Prisma } from '@prisma/client';

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

// ─── Repository ─────────────────────────────────────────────────

export interface AgentTemplateRepository {
  list(filters?: AgentTemplateFilters): Promise<AgentTemplate[]>;
  findBySlug(slug: string): Promise<AgentTemplate | null>;
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
  };
}
