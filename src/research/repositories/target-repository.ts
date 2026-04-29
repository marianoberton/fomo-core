/**
 * ResearchTarget repository — CRUD over `research_targets`.
 *
 * Targets are competitor agents identified by phone number.
 * Every target must have source evidence before being persisted.
 *
 * DSAR (Data Subject Access Request) delete is implemented as:
 *   1. Set `dsarDeletedAt` tombstone on the target row.
 *   2. Cascade-delete all sessions (and through cascade: turns, analyses).
 * The target row is intentionally kept for audit-trail purposes.
 */
import type { PrismaClient, ResearchTarget } from '@prisma/client';
import type { TargetStatus, TargetSourceType } from '@prisma/client';

export type { TargetStatus, TargetSourceType };

// ─── Input types ─────────────────────────────────────────────────

export interface CreateTargetInput {
  name: string;
  company?: string;
  phoneNumber: string;
  verticalSlug: string;
  country?: string;
  sourceType: TargetSourceType;
  sourceValue: string;
  notes?: string;
  priority?: number;
  tags?: string[];
  createdBy: string;
}

export interface UpdateTargetInput {
  name?: string;
  company?: string;
  notes?: string;
  priority?: number;
  tags?: string[];
  updatedBy?: string;
}

export interface TargetFilters {
  verticalSlug?: string;
  status?: TargetStatus;
  country?: string;
  priority?: number;
  optedOut?: boolean;
  q?: string;
  /** When true, include DSAR-deleted tombstones. Default: false. */
  includeDsarDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface BulkCreateResult {
  created: number;
  skipped: number;
  errors: Array<{ row: number; phoneNumber: string; reason: string }>;
}

export interface DsarDeleteResult {
  dsarDeletedAt: Date;
  sessionsDeleted: number;
}

// ─── Interface ───────────────────────────────────────────────────

export interface ResearchTargetRepository {
  /** Create a single target. Throws on duplicate phoneNumber. */
  create(data: CreateTargetInput): Promise<ResearchTarget>;

  /**
   * Bulk-create targets. Duplicates (by phoneNumber) are silently skipped.
   * Compliance failures are collected in `errors`.
   */
  bulkCreate(items: CreateTargetInput[]): Promise<BulkCreateResult>;

  /** List targets with optional filters. */
  findAll(filters?: TargetFilters): Promise<ResearchTarget[]>;

  /** Find one by ID. Returns `null` if not found. */
  findById(id: string): Promise<ResearchTarget | null>;

  /** Find one by phone number (unique). Returns `null` if not found. */
  findByPhoneNumber(phoneNumber: string): Promise<ResearchTarget | null>;

  /** Update editable metadata fields. Does NOT allow changing phoneNumber. */
  update(id: string, data: UpdateTargetInput): Promise<ResearchTarget>;

  /** Change the status. If → `banned`, `reason` is required. */
  updateStatus(id: string, status: TargetStatus, reason?: string, updatedBy?: string): Promise<ResearchTarget>;

  /**
   * Record opt-out: set `optedOutAt` + `optedOutReason` and ban the target.
   * Once opted out the target must never be contacted again.
   */
  markOptedOut(id: string, reason: string): Promise<ResearchTarget>;

  /**
   * DSAR delete: sets `dsarDeletedAt` tombstone and hard-deletes all sessions
   * (cascade removes turns + analyses). The target row is kept for defensibility.
   */
  dsarDelete(id: string): Promise<DsarDeleteResult>;
}

// ─── Factory ─────────────────────────────────────────────────────

/** Create a Prisma-backed ResearchTargetRepository. */
export function createResearchTargetRepository(
  prisma: PrismaClient,
): ResearchTargetRepository {
  return {
    async create(data) {
      return await prisma.researchTarget.create({
        data: {
          name: data.name,
          company: data.company,
          phoneNumber: data.phoneNumber,
          verticalSlug: data.verticalSlug,
          country: data.country ?? 'AR',
          sourceType: data.sourceType,
          sourceValue: data.sourceValue,
          notes: data.notes,
          priority: data.priority ?? 1,
          tags: data.tags ?? [],
          createdBy: data.createdBy,
        },
      });
    },

    async bulkCreate(items) {
      let created = 0;
      let skipped = 0;
      const errors: BulkCreateResult['errors'] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        try {
          await prisma.researchTarget.create({ data: {
            name: item.name,
            company: item.company,
            phoneNumber: item.phoneNumber,
            verticalSlug: item.verticalSlug,
            country: item.country ?? 'AR',
            sourceType: item.sourceType,
            sourceValue: item.sourceValue,
            notes: item.notes,
            priority: item.priority ?? 1,
            tags: item.tags ?? [],
            createdBy: item.createdBy,
          } });
          created++;
        } catch (e) {
          const err = e as { code?: string; message?: string };
          if (err.code === 'P2002') {
            // Unique constraint violation → duplicate phoneNumber
            skipped++;
          } else {
            errors.push({
              row: i + 1,
              phoneNumber: item.phoneNumber,
              reason: err.message ?? 'Unknown error',
            });
          }
        }
      }

      return { created, skipped, errors };
    },

    async findAll(filters = {}) {
      const {
        verticalSlug,
        status,
        country,
        priority,
        optedOut,
        q,
        includeDsarDeleted = false,
        limit = 100,
        offset = 0,
      } = filters;

      return await prisma.researchTarget.findMany({
        where: {
          ...(verticalSlug && { verticalSlug }),
          ...(status && { status }),
          ...(country && { country }),
          ...(priority !== undefined && { priority }),
          ...(optedOut === true && { optedOutAt: { not: null } }),
          ...(optedOut === false && { optedOutAt: null }),
          ...(!includeDsarDeleted && { dsarDeletedAt: null }),
          ...(q && {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { company: { contains: q, mode: 'insensitive' } },
              { phoneNumber: { contains: q } },
            ],
          }),
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
      });
    },

    async findById(id) {
      return await prisma.researchTarget.findUnique({ where: { id } });
    },

    async findByPhoneNumber(phoneNumber) {
      return await prisma.researchTarget.findUnique({ where: { phoneNumber } });
    },

    async update(id, data) {
      return await prisma.researchTarget.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.company !== undefined && { company: data.company }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.priority !== undefined && { priority: data.priority }),
          ...(data.tags !== undefined && { tags: data.tags }),
          ...(data.updatedBy !== undefined && { updatedBy: data.updatedBy }),
        },
      });
    },

    async updateStatus(id, status, reason, updatedBy) {
      return await prisma.researchTarget.update({
        where: { id },
        data: {
          status,
          ...(reason !== undefined && status === 'banned' && { optedOutReason: reason }),
          ...(updatedBy !== undefined && { updatedBy }),
        },
      });
    },

    async markOptedOut(id, reason) {
      return await prisma.researchTarget.update({
        where: { id },
        data: {
          status: 'banned',
          optedOutAt: new Date(),
          optedOutReason: reason,
        },
      });
    },

    async dsarDelete(id) {
      // 1. Tombstone the target row
      await prisma.researchTarget.update({
        where: { id },
        data: { dsarDeletedAt: new Date() },
      });

      // 2. Hard-delete sessions (cascade removes turns + analyses via DB FK)
      const { count: sessionsDeleted } = await prisma.researchSession.deleteMany({
        where: { targetId: id },
      });

      return {
        dsarDeletedAt: new Date(),
        sessionsDeleted,
      };
    },
  };
}
