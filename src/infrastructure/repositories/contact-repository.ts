/**
 * Contact repository — CRUD for contacts.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import type {
  Contact,
  ContactId,
  ContactRepository,
  CreateContactInput,
  UpdateContactInput,
  ChannelIdentifier,
  ContactListOptions,
} from '@/contacts/types.js';

// ─── Mapper ─────────────────────────────────────────────────────

function toContactModel(record: {
  id: string;
  projectId: string;
  name: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  telegramId: string | null;
  slackId: string | null;
  timezone: string | null;
  language: string;
  role: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): Contact {
  return {
    id: record.id,
    projectId: record.projectId as ProjectId,
    name: record.name,
    displayName: record.displayName ?? undefined,
    phone: record.phone ?? undefined,
    email: record.email ?? undefined,
    telegramId: record.telegramId ?? undefined,
    slackId: record.slackId ?? undefined,
    timezone: record.timezone ?? undefined,
    language: record.language,
    role: record.role ?? undefined,
    metadata: (record.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/**
 * Create a ContactRepository backed by Prisma.
 */
export function createContactRepository(prisma: PrismaClient): ContactRepository {
  return {
    async create(input: CreateContactInput): Promise<Contact> {
      const record = await prisma.contact.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          displayName: input.displayName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          telegramId: input.telegramId ?? null,
          slackId: input.slackId ?? null,
          timezone: input.timezone ?? null,
          language: input.language ?? 'es',
          role: input.role ?? null,
          metadata: input.metadata as Prisma.InputJsonValue,
        },
      });
      return toContactModel(record);
    },

    async findById(id: ContactId): Promise<Contact | null> {
      const record = await prisma.contact.findUnique({ where: { id } });
      if (!record) return null;
      return toContactModel(record);
    },

    async findByChannel(
      projectId: ProjectId,
      identifier: ChannelIdentifier,
    ): Promise<Contact | null> {
      let record = null;

      switch (identifier.type) {
        case 'phone':
          record = await prisma.contact.findUnique({
            where: { projectId_phone: { projectId, phone: identifier.value } },
          });
          break;
        case 'email':
          record = await prisma.contact.findUnique({
            where: { projectId_email: { projectId, email: identifier.value } },
          });
          break;
        case 'telegramId':
          record = await prisma.contact.findUnique({
            where: { projectId_telegramId: { projectId, telegramId: identifier.value } },
          });
          break;
        case 'slackId':
          record = await prisma.contact.findUnique({
            where: { projectId_slackId: { projectId, slackId: identifier.value } },
          });
          break;
      }

      if (!record) return null;
      return toContactModel(record);
    },

    async update(id: ContactId, input: UpdateContactInput): Promise<Contact> {
      const record = await prisma.contact.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.displayName !== undefined && { displayName: input.displayName }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.telegramId !== undefined && { telegramId: input.telegramId }),
          ...(input.slackId !== undefined && { slackId: input.slackId }),
          ...(input.timezone !== undefined && { timezone: input.timezone }),
          ...(input.language !== undefined && { language: input.language }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.metadata !== undefined && { metadata: input.metadata as Prisma.InputJsonValue }),
        },
      });
      return toContactModel(record);
    },

    async delete(id: ContactId): Promise<void> {
      await prisma.contact.delete({ where: { id } });
    },

    async list(projectId: ProjectId, options?: ContactListOptions): Promise<Contact[]> {
      const records = await prisma.contact.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: options?.limit,
        skip: options?.offset,
      });
      return records.map(toContactModel);
    },
  };
}
