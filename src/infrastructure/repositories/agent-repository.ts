/**
 * Agent repository — CRUD for agents.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  AgentId,
  AgentConfig,
  AgentRepository,
  CreateAgentInput,
  UpdateAgentInput,
  AgentPromptConfig,
  MCPServerConfig,
  ChannelConfig,
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

function toAgentConfig(record: {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  promptConfig: unknown;
  toolAllowlist: string[];
  mcpServers: unknown;
  channelConfig: unknown;
  maxTurns: number;
  maxTokensPerTurn: number;
  budgetPerDayUsd: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): AgentConfig {
  return {
    id: record.id as AgentId,
    projectId: record.projectId as ProjectId,
    name: record.name,
    description: record.description ?? undefined,
    promptConfig: record.promptConfig as AgentPromptConfig,
    toolAllowlist: record.toolAllowlist,
    mcpServers: (record.mcpServers as MCPServerConfig[] | null) ?? [],
    channelConfig: (record.channelConfig as ChannelConfig | null) ?? DEFAULT_CHANNEL_CONFIG,
    limits: {
      maxTurns: record.maxTurns,
      maxTokensPerTurn: record.maxTokensPerTurn,
      budgetPerDayUsd: record.budgetPerDayUsd,
    },
    status: record.status as AgentStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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

      const record = await prisma.agent.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? null,
          promptConfig: input.promptConfig as unknown as Prisma.InputJsonValue,
          toolAllowlist: input.toolAllowlist ?? [],
          mcpServers: (input.mcpServers ?? []) as unknown as Prisma.InputJsonValue,
          channelConfig: channelConfig as unknown as Prisma.InputJsonValue,
          maxTurns: limits.maxTurns,
          maxTokensPerTurn: limits.maxTokensPerTurn,
          budgetPerDayUsd: limits.budgetPerDayUsd,
          status: 'active',
        },
      });

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
