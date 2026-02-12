/**
 * Prisma-backed ApprovalStore for persistent approval request tracking.
 * Maps between the app's ApprovalRequest type and the Prisma ApprovalRequest model.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';
import type { ApprovalRequest, ApprovalStatus, ApprovalStore } from './types.js';

/** Map a Prisma ApprovalRequest record to the app's ApprovalRequest type. */
function toAppModel(record: {
  id: string;
  projectId: string;
  sessionId: string;
  toolCallId: string;
  toolId: string;
  toolInput: unknown;
  riskLevel: string;
  status: string;
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}): ApprovalRequest {
  return {
    id: record.id as ApprovalId,
    projectId: record.projectId as ProjectId,
    sessionId: record.sessionId as SessionId,
    toolCallId: record.toolCallId as ToolCallId,
    toolId: record.toolId,
    toolInput: record.toolInput as Record<string, unknown>,
    riskLevel: record.riskLevel as 'high' | 'critical',
    status: record.status as ApprovalStatus,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
    resolvedAt: record.resolvedAt ?? undefined,
    resolvedBy: record.resolvedBy ?? undefined,
    resolutionNote: record.resolutionNote ?? undefined,
  };
}

/**
 * Create a Prisma-backed ApprovalStore.
 */
export function createPrismaApprovalStore(prisma: PrismaClient): ApprovalStore {
  return {
    async create(request: ApprovalRequest): Promise<void> {
      await prisma.approvalRequest.create({
        data: {
          id: request.id,
          projectId: request.projectId,
          sessionId: request.sessionId,
          toolCallId: request.toolCallId,
          toolId: request.toolId,
          toolInput: request.toolInput as Prisma.InputJsonValue,
          riskLevel: request.riskLevel,
          status: request.status,
          requestedAt: request.requestedAt,
          expiresAt: request.expiresAt,
          resolvedAt: request.resolvedAt ?? null,
          resolvedBy: request.resolvedBy ?? null,
          resolutionNote: request.resolutionNote ?? null,
        },
      });
    },

    async get(id: ApprovalId): Promise<ApprovalRequest | undefined> {
      const record = await prisma.approvalRequest.findUnique({
        where: { id },
      });
      if (!record) return undefined;
      return toAppModel(record);
    },

    async update(id: ApprovalId, updates: Partial<ApprovalRequest>): Promise<ApprovalRequest | null> {
      try {
        const record = await prisma.approvalRequest.update({
          where: { id },
          data: {
            ...(updates.status !== undefined && { status: updates.status }),
            ...(updates.resolvedAt !== undefined && { resolvedAt: updates.resolvedAt }),
            ...(updates.resolvedBy !== undefined && { resolvedBy: updates.resolvedBy }),
            ...(updates.resolutionNote !== undefined && { resolutionNote: updates.resolutionNote }),
          },
        });
        return toAppModel(record);
      } catch {
        return null;
      }
    },

    async listPending(projectId: ProjectId): Promise<ApprovalRequest[]> {
      const records = await prisma.approvalRequest.findMany({
        where: { projectId, status: 'pending' },
        orderBy: { requestedAt: 'desc' },
      });
      return records.map(toAppModel);
    },

    async listAll(): Promise<ApprovalRequest[]> {
      const records = await prisma.approvalRequest.findMany({
        orderBy: { requestedAt: 'desc' },
      });
      return records.map(toAppModel);
    },
  };
}
