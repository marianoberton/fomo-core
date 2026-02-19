/**
 * Channel integration repository — CRUD for channel integrations (all providers).
 */
import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  ChannelIntegration,
  ChannelIntegrationId,
  ChannelIntegrationRepository,
  ChatwootIntegrationConfig,
  CreateChannelIntegrationInput,
  IntegrationConfigUnion,
  IntegrationProvider,
  UpdateChannelIntegrationInput,
} from '@/channels/types.js';

// ─── Mapper ─────────────────────────────────────────────────────

function toModel(record: {
  id: string;
  projectId: string;
  provider: string;
  config: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ChannelIntegration {
  return {
    id: record.id,
    projectId: record.projectId as ProjectId,
    provider: record.provider as IntegrationProvider,
    config: record.config as IntegrationConfigUnion,
    status: record.status as 'active' | 'paused',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create a ChannelIntegrationRepository backed by Prisma.
 */
export function createChannelIntegrationRepository(prisma: PrismaClient): ChannelIntegrationRepository {
  return {
    async create(input: CreateChannelIntegrationInput): Promise<ChannelIntegration> {
      const record = await prisma.channelIntegration.create({
        data: {
          projectId: input.projectId,
          provider: input.provider,
          config: input.config as unknown as Prisma.InputJsonValue,
          status: input.status ?? 'active',
        },
      });
      return toModel(record);
    },

    async findById(id: ChannelIntegrationId): Promise<ChannelIntegration | null> {
      const record = await prisma.channelIntegration.findUnique({ where: { id } });
      if (!record) return null;
      return toModel(record);
    },

    async findByProject(projectId: ProjectId): Promise<ChannelIntegration[]> {
      const records = await prisma.channelIntegration.findMany({
        where: { projectId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toModel);
    },

    async findByProjectAndProvider(
      projectId: ProjectId,
      provider: IntegrationProvider,
    ): Promise<ChannelIntegration | null> {
      const record = await prisma.channelIntegration.findFirst({
        where: { projectId, provider },
      });
      if (!record) return null;
      return toModel(record);
    },

    async findByProviderAccount(
      provider: IntegrationProvider,
      accountId: number,
    ): Promise<ChannelIntegration | null> {
      // Search through active integrations for matching accountId in config (Chatwoot-specific)
      const records = await prisma.channelIntegration.findMany({
        where: { provider, status: 'active' },
      });

      for (const record of records) {
        const config = record.config as unknown as ChatwootIntegrationConfig;
        if (config.accountId === accountId) {
          return toModel(record);
        }
      }

      return null;
    },

    async update(
      id: ChannelIntegrationId,
      input: UpdateChannelIntegrationInput,
    ): Promise<ChannelIntegration> {
      const record = await prisma.channelIntegration.update({
        where: { id },
        data: {
          ...(input.config !== undefined && { config: input.config as unknown as Prisma.InputJsonValue }),
          ...(input.status !== undefined && { status: input.status }),
        },
      });
      return toModel(record);
    },

    async delete(id: ChannelIntegrationId): Promise<void> {
      await prisma.channelIntegration.delete({ where: { id } });
    },

    async listActive(): Promise<ChannelIntegration[]> {
      const records = await prisma.channelIntegration.findMany({
        where: { status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toModel);
    },
  };
}
