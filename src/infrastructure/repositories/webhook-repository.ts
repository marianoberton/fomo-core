/**
 * Webhook repository — CRUD for webhooks.
 */
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  Webhook,
  WebhookId,
  WebhookRepository,
  CreateWebhookInput,
  UpdateWebhookInput,
} from '@/webhooks/types.js';

// ─── Mapper ─────────────────────────────────────────────────────

function toWebhookModel(record: {
  id: string;
  projectId: string;
  agentId: string | null;
  name: string;
  description: string | null;
  triggerPrompt: string;
  secretEnvVar: string | null;
  allowedIps: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Webhook {
  return {
    id: record.id,
    projectId: record.projectId as ProjectId,
    agentId: record.agentId ?? undefined,
    name: record.name,
    description: record.description ?? undefined,
    triggerPrompt: record.triggerPrompt,
    secretEnvVar: record.secretEnvVar ?? undefined,
    allowedIps: record.allowedIps.length > 0 ? record.allowedIps : undefined,
    status: record.status as 'active' | 'paused',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create a WebhookRepository backed by Prisma.
 */
export function createWebhookRepository(prisma: PrismaClient): WebhookRepository {
  return {
    async create(input: CreateWebhookInput): Promise<Webhook> {
      const record = await prisma.webhook.create({
        data: {
          projectId: input.projectId,
          agentId: input.agentId ?? null,
          name: input.name,
          description: input.description ?? null,
          triggerPrompt: input.triggerPrompt,
          secretEnvVar: input.secretEnvVar ?? null,
          allowedIps: input.allowedIps ?? [],
          status: input.status ?? 'active',
        },
      });
      return toWebhookModel(record);
    },

    async findById(id: WebhookId): Promise<Webhook | null> {
      const record = await prisma.webhook.findUnique({ where: { id } });
      if (!record) return null;
      return toWebhookModel(record);
    },

    async update(id: WebhookId, input: UpdateWebhookInput): Promise<Webhook> {
      const record = await prisma.webhook.update({
        where: { id },
        data: {
          ...(input.agentId !== undefined && { agentId: input.agentId }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.triggerPrompt !== undefined && { triggerPrompt: input.triggerPrompt }),
          ...(input.secretEnvVar !== undefined && { secretEnvVar: input.secretEnvVar }),
          ...(input.allowedIps !== undefined && { allowedIps: input.allowedIps }),
          ...(input.status !== undefined && { status: input.status }),
        },
      });
      return toWebhookModel(record);
    },

    async delete(id: WebhookId): Promise<void> {
      await prisma.webhook.delete({ where: { id } });
    },

    async list(projectId: ProjectId): Promise<Webhook[]> {
      const records = await prisma.webhook.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toWebhookModel);
    },

    async listActive(projectId: ProjectId): Promise<Webhook[]> {
      const records = await prisma.webhook.findMany({
        where: { projectId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toWebhookModel);
    },
  };
}
