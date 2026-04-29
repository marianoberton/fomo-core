/**
 * Write-only repository for `research_audit_log`.
 *
 * Intentionally INSERT-only — audit records are immutable.
 * Query access is via Prisma Studio or raw SQL (no need for a read API).
 */
import type { PrismaClient, ResearchAuditLog } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface CreateAuditLogInput {
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface ResearchAuditLogRepository {
  log(entry: CreateAuditLogInput): Promise<ResearchAuditLog>;
}

export function createResearchAuditLogRepository(prisma: PrismaClient): ResearchAuditLogRepository {
  async function log(entry: CreateAuditLogInput): Promise<ResearchAuditLog> {
    return prisma.researchAuditLog.create({
      data: {
        actorEmail: entry.actorEmail,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        payload: entry.payload as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }

  return { log };
}
