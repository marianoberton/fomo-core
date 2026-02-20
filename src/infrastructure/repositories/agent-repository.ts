/**
 * Agent repository — CRUD for agents.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  AgentId,
  AgentConfig,
  AgentRepository,
  CreateAgentInput,
  UpdateAgentInput,
  AgentPromptConfig,
  AgentLLMConfig,
  MCPServerConfig,
  ChannelConfig,
  AgentMode,
  AgentLimits,
  AgentStatus,
} from '@/agents/types.js';

// ─── Default Values ─────────────────────────────────────────────

const DEFAULT_LIMITS: AgentLimits = {
  maxTurns: 10,
  maxTokensPerTurn: 4000,
  budgetPerDayUsd: 10.0,
};

const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  allowedChannels: [],
  defaultChannel: undefined,
};

// ─── Mapper ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
type AgentRecord = Awaited<ReturnType<PrismaClient['agent']['findUniqueOrThrow']>>;

function toAgentConfig(record: AgentRecord): AgentConfig {
  const rec = record as AgentRecord & { llmConfig?: unknown; modes?: unknown };
  return {
    id: rec.id as AgentId,
    projectId: rec.projectId as ProjectId,
    name: rec.name,
    description: rec.description ?? undefined,
    promptConfig: rec.promptConfig as unknown as AgentPromptConfig,
    llmConfig: (rec.llmConfig as AgentLLMConfig | null | undefined) ?? undefined,
    toolAllowlist: rec.toolAllowlist,
    mcpServers: (rec.mcpServers as MCPServerConfig[] | null) ?? [],
    channelConfig: (rec.channelConfig as ChannelConfig | null) ?? DEFAULT_CHANNEL_CONFIG,
    modes: (rec.modes as AgentMode[] | null) ?? [],
    limits: {
      maxTurns: rec.maxTurns,
      maxTokensPerTurn: rec.maxTokensPerTurn,
      budgetPerDayUsd: rec.budgetPerDayUsd,
    },
    status: rec.status as AgentStatus,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create an AgentRepository backed by Prisma.
 */
export function createAgentRepository(prisma: PrismaClient): AgentRepository {
  return {
    async create(input: CreateAgentInput): Promise<AgentConfig> {
      const limits = { ...DEFAULT_LIMITS, ...input.limits };
      const channelConfig = input.channelConfig ?? DEFAULT_CHANNEL_CONFIG;

      // Note: llmConfig requires `prisma generate` after migration. Cast to bypass
      // type checking until the Prisma client is regenerated.
      const createData = {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        promptConfig: input.promptConfig as unknown as Prisma.InputJsonValue,
        llmConfig: input.llmConfig
          ? (input.llmConfig as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        toolAllowlist: input.toolAllowlist ?? [],
        mcpServers: (input.mcpServers ?? []) as unknown as Prisma.InputJsonValue,
        channelConfig: channelConfig as unknown as Prisma.InputJsonValue,
        modes: input.modes && input.modes.length > 0
          ? (input.modes as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        maxTurns: limits.maxTurns,
        maxTokensPerTurn: limits.maxTokensPerTurn,
        budgetPerDayUsd: limits.budgetPerDayUsd,
        status: 'active',
      } as Prisma.AgentUncheckedCreateInput;

      const record = await prisma.agent.create({ data: createData });

      return toAgentConfig(record);
    },

    async findById(id: AgentId): Promise<AgentConfig | null> {
      const record = await prisma.agent.findUnique({ where: { id } });
      if (!record) return null;
      return toAgentConfig(record);
    },

    async findByName(projectId: string, name: string): Promise<AgentConfig | null> {
      const record = await prisma.agent.findUnique({
        where: {
          projectId_name: { projectId, name },
        },
      });
      if (!record) return null;
      return toAgentConfig(record);
    },

    async update(id: AgentId, input: UpdateAgentInput): Promise<AgentConfig> {
      const updateData: Prisma.AgentUpdateInput = {};

      if (input.name !== undefined) {
        updateData.name = input.name;
      }
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.promptConfig !== undefined) {
        updateData.promptConfig = input.promptConfig as unknown as Prisma.InputJsonValue;
      }
      if (input.toolAllowlist !== undefined) {
        updateData.toolAllowlist = input.toolAllowlist;
      }
      if (input.mcpServers !== undefined) {
        updateData.mcpServers = input.mcpServers as unknown as Prisma.InputJsonValue;
      }
      if (input.channelConfig !== undefined) {
        updateData.channelConfig = input.channelConfig as unknown as Prisma.InputJsonValue;
      }
      if (input.status !== undefined) {
        updateData.status = input.status;
      }
      if (input.limits !== undefined) {
        if (input.limits.maxTurns !== undefined) {
          updateData.maxTurns = input.limits.maxTurns;
        }
        if (input.limits.maxTokensPerTurn !== undefined) {
          updateData.maxTokensPerTurn = input.limits.maxTokensPerTurn;
        }
        if (input.limits.budgetPerDayUsd !== undefined) {
          updateData.budgetPerDayUsd = input.limits.budgetPerDayUsd;
        }
      }

      // llmConfig + modes require `prisma generate` — cast to add them to updateData
      if (input.llmConfig !== undefined) {
        const extended = updateData as Prisma.AgentUpdateInput & { llmConfig: unknown };
        extended.llmConfig = input.llmConfig
          ? (input.llmConfig as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }
      if (input.modes !== undefined) {
        const extended = updateData as Prisma.AgentUpdateInput & { modes: unknown };
        extended.modes = input.modes.length > 0
          ? (input.modes as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }

      const record = await prisma.agent.update({
        where: { id },
        data: updateData,
      });

      return toAgentConfig(record);
    },

    async delete(id: AgentId): Promise<void> {
      await prisma.agent.delete({ where: { id } });
    },

    async list(projectId: string): Promise<AgentConfig[]> {
      const records = await prisma.agent.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAgentConfig);
    },

    async listActive(projectId: string): Promise<AgentConfig[]> {
      const records = await prisma.agent.findMany({
        where: { projectId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAgentConfig);
    },

    async listAll(): Promise<AgentConfig[]> {
      const records = await prisma.agent.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAgentConfig);
    },
  };
}
