/**
 * MCP Server repository — CRUD for MCP server templates and instances.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface MCPServerTemplate {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  transport: string;
  command?: string;
  args: string[];
  defaultEnv?: Record<string, string>;
  url?: string;
  toolPrefix?: string;
  requiredSecrets: string[];
  isOfficial: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MCPServerInstance {
  id: string;
  projectId: ProjectId;
  templateId?: string;
  name: string;
  displayName?: string;
  description?: string;
  transport: string;
  command?: string;
  args: string[];
  envSecretKeys?: Record<string, string>;
  url?: string;
  toolPrefix?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplateInput {
  name: string;
  displayName: string;
  description: string;
  category: string;
  transport: string;
  command?: string;
  args?: string[];
  defaultEnv?: Record<string, string>;
  url?: string;
  toolPrefix?: string;
  requiredSecrets?: string[];
  isOfficial?: boolean;
}

export interface CreateInstanceInput {
  projectId: ProjectId;
  templateId?: string;
  name: string;
  displayName?: string;
  description?: string;
  transport: string;
  command?: string;
  args?: string[];
  envSecretKeys?: Record<string, string>;
  url?: string;
  toolPrefix?: string;
}

export interface UpdateInstanceInput {
  displayName?: string;
  description?: string;
  transport?: string;
  command?: string;
  args?: string[];
  envSecretKeys?: Record<string, string>;
  url?: string;
  toolPrefix?: string;
  status?: string;
}

export interface MCPServerRepository {
  // Templates
  listTemplates(category?: string): Promise<MCPServerTemplate[]>;
  findTemplateById(id: string): Promise<MCPServerTemplate | null>;
  findTemplateByName(name: string): Promise<MCPServerTemplate | null>;
  createTemplate(input: CreateTemplateInput): Promise<MCPServerTemplate>;

  // Instances
  listInstances(projectId: ProjectId, status?: string): Promise<MCPServerInstance[]>;
  findInstanceById(id: string): Promise<MCPServerInstance | null>;
  createInstance(input: CreateInstanceInput): Promise<MCPServerInstance>;
  updateInstance(id: string, input: UpdateInstanceInput): Promise<MCPServerInstance>;
  deleteInstance(id: string): Promise<void>;
}

// ─── Mappers ────────────────────────────────────────────────────

type TemplateRecord = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  transport: string;
  command: string | null;
  args: string[];
  defaultEnv: unknown;
  url: string | null;
  toolPrefix: string | null;
  requiredSecrets: string[];
  isOfficial: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toTemplate(rec: TemplateRecord): MCPServerTemplate {
  return {
    id: rec.id,
    name: rec.name,
    displayName: rec.displayName,
    description: rec.description,
    category: rec.category,
    transport: rec.transport,
    command: rec.command ?? undefined,
    args: rec.args,
    defaultEnv: (rec.defaultEnv as Record<string, string> | null) ?? undefined,
    url: rec.url ?? undefined,
    toolPrefix: rec.toolPrefix ?? undefined,
    requiredSecrets: rec.requiredSecrets,
    isOfficial: rec.isOfficial,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

type InstanceRecord = {
  id: string;
  projectId: string;
  templateId: string | null;
  name: string;
  displayName: string | null;
  description: string | null;
  transport: string;
  command: string | null;
  args: string[];
  envSecretKeys: unknown;
  url: string | null;
  toolPrefix: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function toInstance(rec: InstanceRecord): MCPServerInstance {
  return {
    id: rec.id,
    projectId: rec.projectId as ProjectId,
    templateId: rec.templateId ?? undefined,
    name: rec.name,
    displayName: rec.displayName ?? undefined,
    description: rec.description ?? undefined,
    transport: rec.transport,
    command: rec.command ?? undefined,
    args: rec.args,
    envSecretKeys: (rec.envSecretKeys as Record<string, string> | null) ?? undefined,
    url: rec.url ?? undefined,
    toolPrefix: rec.toolPrefix ?? undefined,
    status: rec.status,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

// ─── Repository Factory ─────────────────────────────────────────

/** Create an MCPServerRepository backed by Prisma. */
export function createMCPServerRepository(prisma: PrismaClient): MCPServerRepository {
  // Cast to access new models before `prisma generate` regenerates the client
  const db = prisma as PrismaClient & {
    mCPServerTemplate: PrismaClient['$extends'] extends never ? never : {
      findMany: (args?: unknown) => Promise<TemplateRecord[]>;
      findUnique: (args: unknown) => Promise<TemplateRecord | null>;
      create: (args: unknown) => Promise<TemplateRecord>;
    };
    mCPServerInstance: {
      findMany: (args?: unknown) => Promise<InstanceRecord[]>;
      findUnique: (args: unknown) => Promise<InstanceRecord | null>;
      create: (args: unknown) => Promise<InstanceRecord>;
      update: (args: unknown) => Promise<InstanceRecord>;
      delete: (args: unknown) => Promise<InstanceRecord>;
    };
  };

  return {
    // ─── Templates ─────────────────────────────────────────────

    async listTemplates(category?: string): Promise<MCPServerTemplate[]> {
      const where = category ? { category } : {};
      const records = await (db as unknown as { mCPServerTemplate: { findMany: (a: unknown) => Promise<TemplateRecord[]> } }).mCPServerTemplate.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      return records.map(toTemplate);
    },

    async findTemplateById(id: string): Promise<MCPServerTemplate | null> {
      const record = await (db as unknown as { mCPServerTemplate: { findUnique: (a: unknown) => Promise<TemplateRecord | null> } }).mCPServerTemplate.findUnique({
        where: { id },
      });
      if (!record) return null;
      return toTemplate(record);
    },

    async findTemplateByName(name: string): Promise<MCPServerTemplate | null> {
      const record = await (db as unknown as { mCPServerTemplate: { findUnique: (a: unknown) => Promise<TemplateRecord | null> } }).mCPServerTemplate.findUnique({
        where: { name },
      });
      if (!record) return null;
      return toTemplate(record);
    },

    async createTemplate(input: CreateTemplateInput): Promise<MCPServerTemplate> {
      const record = await (db as unknown as { mCPServerTemplate: { create: (a: unknown) => Promise<TemplateRecord> } }).mCPServerTemplate.create({
        data: {
          name: input.name,
          displayName: input.displayName,
          description: input.description,
          category: input.category,
          transport: input.transport,
          command: input.command ?? null,
          args: input.args ?? [],
          defaultEnv: input.defaultEnv ? (input.defaultEnv as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          url: input.url ?? null,
          toolPrefix: input.toolPrefix ?? null,
          requiredSecrets: input.requiredSecrets ?? [],
          isOfficial: input.isOfficial ?? false,
        },
      });
      return toTemplate(record);
    },

    // ─── Instances ─────────────────────────────────────────────

    async listInstances(projectId: ProjectId, status?: string): Promise<MCPServerInstance[]> {
      const where: Record<string, unknown> = { projectId };
      if (status) where['status'] = status;
      const records = await (db as unknown as { mCPServerInstance: { findMany: (a: unknown) => Promise<InstanceRecord[]> } }).mCPServerInstance.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      return records.map(toInstance);
    },

    async findInstanceById(id: string): Promise<MCPServerInstance | null> {
      const record = await (db as unknown as { mCPServerInstance: { findUnique: (a: unknown) => Promise<InstanceRecord | null> } }).mCPServerInstance.findUnique({
        where: { id },
      });
      if (!record) return null;
      return toInstance(record);
    },

    async createInstance(input: CreateInstanceInput): Promise<MCPServerInstance> {
      const record = await (db as unknown as { mCPServerInstance: { create: (a: unknown) => Promise<InstanceRecord> } }).mCPServerInstance.create({
        data: {
          projectId: input.projectId,
          templateId: input.templateId ?? null,
          name: input.name,
          displayName: input.displayName ?? null,
          description: input.description ?? null,
          transport: input.transport,
          command: input.command ?? null,
          args: input.args ?? [],
          envSecretKeys: input.envSecretKeys ? (input.envSecretKeys as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          url: input.url ?? null,
          toolPrefix: input.toolPrefix ?? null,
          status: 'active',
        },
      });
      return toInstance(record);
    },

    async updateInstance(id: string, input: UpdateInstanceInput): Promise<MCPServerInstance> {
      const data: Record<string, unknown> = {};
      if (input.displayName !== undefined) data['displayName'] = input.displayName;
      if (input.description !== undefined) data['description'] = input.description;
      if (input.transport !== undefined) data['transport'] = input.transport;
      if (input.command !== undefined) data['command'] = input.command;
      if (input.args !== undefined) data['args'] = input.args;
      if (input.envSecretKeys !== undefined) {
        data['envSecretKeys'] = input.envSecretKeys
          ? (input.envSecretKeys as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }
      if (input.url !== undefined) data['url'] = input.url;
      if (input.toolPrefix !== undefined) data['toolPrefix'] = input.toolPrefix;
      if (input.status !== undefined) data['status'] = input.status;

      const record = await (db as unknown as { mCPServerInstance: { update: (a: unknown) => Promise<InstanceRecord> } }).mCPServerInstance.update({
        where: { id },
        data,
      });
      return toInstance(record);
    },

    async deleteInstance(id: string): Promise<void> {
      await (db as unknown as { mCPServerInstance: { delete: (a: unknown) => Promise<unknown> } }).mCPServerInstance.delete({
        where: { id },
      });
    },
  };
}
