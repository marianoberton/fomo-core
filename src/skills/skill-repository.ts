/**
 * Prisma-backed Skill Repository
 *
 * CRUD operations for SkillTemplate and SkillInstance.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type {
  SkillRepository,
  SkillTemplate,
  SkillInstance,
  SkillCategory,
  SkillTemplateStatus,
  SkillInstanceStatus,
  CreateSkillInstanceInput,
  UpdateSkillInstanceInput,
} from './types.js';

// ─── Mappers ────────────────────────────────────────────────

type TemplateRecord = Awaited<ReturnType<PrismaClient['skillTemplate']['findUniqueOrThrow']>>;
type InstanceRecord = Awaited<ReturnType<PrismaClient['skillInstance']['findUniqueOrThrow']>>;

function toSkillTemplate(record: TemplateRecord): SkillTemplate {
  return {
    id: record.id,
    name: record.name,
    displayName: record.displayName,
    description: record.description,
    category: record.category as SkillCategory,
    instructionsFragment: record.instructionsFragment,
    requiredTools: record.requiredTools,
    requiredMcpServers: record.requiredMcpServers,
    parametersSchema: record.parametersSchema as Record<string, unknown> | null,
    tags: record.tags,
    icon: record.icon,
    isOfficial: record.isOfficial,
    version: record.version,
    status: record.status as SkillTemplateStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toSkillInstance(record: InstanceRecord): SkillInstance {
  return {
    id: record.id,
    projectId: record.projectId,
    templateId: record.templateId,
    name: record.name,
    displayName: record.displayName,
    description: record.description,
    instructionsFragment: record.instructionsFragment,
    requiredTools: record.requiredTools,
    requiredMcpServers: record.requiredMcpServers,
    parameters: record.parameters as Record<string, unknown> | null,
    status: record.status as SkillInstanceStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────

/**
 * Creates a Prisma-backed SkillRepository.
 */
export function createSkillRepository(prisma: PrismaClient): SkillRepository {
  return {
    async listTemplates(category?: SkillCategory): Promise<SkillTemplate[]> {
      const where = category ? { category, status: 'published' } : { status: 'published' };
      const records = await prisma.skillTemplate.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      return records.map(toSkillTemplate);
    },

    async getTemplate(id: string): Promise<SkillTemplate | null> {
      const record = await prisma.skillTemplate.findUnique({ where: { id } });
      if (!record) return null;
      return toSkillTemplate(record);
    },

    async listInstances(projectId: string): Promise<SkillInstance[]> {
      const records = await prisma.skillInstance.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toSkillInstance);
    },

    async getInstance(id: string): Promise<SkillInstance | null> {
      const record = await prisma.skillInstance.findUnique({ where: { id } });
      if (!record) return null;
      return toSkillInstance(record);
    },

    async getInstancesByIds(ids: string[]): Promise<SkillInstance[]> {
      if (ids.length === 0) return [];
      const records = await prisma.skillInstance.findMany({
        where: { id: { in: ids } },
      });
      return records.map(toSkillInstance);
    },

    async createInstance(input: CreateSkillInstanceInput): Promise<SkillInstance> {
      const record = await prisma.skillInstance.create({
        data: {
          projectId: input.projectId,
          templateId: input.templateId ?? null,
          name: input.name,
          displayName: input.displayName,
          description: input.description ?? null,
          instructionsFragment: input.instructionsFragment,
          requiredTools: input.requiredTools ?? [],
          requiredMcpServers: input.requiredMcpServers ?? [],
          parameters: input.parameters ? (input.parameters as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
      return toSkillInstance(record);
    },

    async updateInstance(id: string, input: UpdateSkillInstanceInput): Promise<SkillInstance> {
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data['name'] = input.name;
      if (input.displayName !== undefined) data['displayName'] = input.displayName;
      if (input.description !== undefined) data['description'] = input.description;
      if (input.instructionsFragment !== undefined) data['instructionsFragment'] = input.instructionsFragment;
      if (input.requiredTools !== undefined) data['requiredTools'] = input.requiredTools;
      if (input.requiredMcpServers !== undefined) data['requiredMcpServers'] = input.requiredMcpServers;
      if (input.parameters !== undefined) data['parameters'] = input.parameters;
      if (input.status !== undefined) data['status'] = input.status;

      const record = await prisma.skillInstance.update({
        where: { id },
        data,
      });
      return toSkillInstance(record);
    },

    async deleteInstance(id: string): Promise<void> {
      await prisma.skillInstance.delete({ where: { id } });
    },
  };
}
