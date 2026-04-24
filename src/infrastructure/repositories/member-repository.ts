/**
 * ProjectMember repository — CRUD for the project_members table.
 *
 * Scope:
 *   - Dashboard operators (human users) are stored here with a role.
 *   - Machine callers (API keys) live in the `api_keys` table — see
 *     `api-key-service.ts`. Do NOT conflate the two.
 *
 * The `userId` field holds the authenticated user's stable id. Until
 * the auth provider is wired up we fall back to using `email` as the
 * userId (see routes/members.ts); this keeps (projectId, userId)
 * unique without requiring a users table.
 */
import type { PrismaClient, ProjectRole } from '@prisma/client';

// ─── Types ─────────────────────────────────────────────────────

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  email: string;
  role: ProjectRole;
  invitedBy: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberUpsertInput {
  projectId: string;
  email: string;
  role: ProjectRole;
  /** Optional — defaults to `email` when the auth provider is not yet wired. */
  userId?: string;
  /** Caller's identifier (email) — stored for audit. */
  invitedBy?: string | null;
}

// ─── Repository interface ──────────────────────────────────────

export interface MemberRepository {
  /** List every member of a project, ordered by createdAt desc. */
  findByProjectId(projectId: string): Promise<ProjectMember[]>;
  /** Lookup a single member by project + email. Email must already be lowercased by the caller. */
  findByEmail(projectId: string, email: string): Promise<ProjectMember | null>;
  /**
   * Idempotent create-or-update by (projectId, email).
   * If a member with that email already exists in the project, their role (and invitedBy)
   * are updated and the record is returned.  Returns the resulting record in both cases.
   */
  upsert(input: MemberUpsertInput): Promise<ProjectMember>;
  /** Change a member's role by id. Returns null when the id does not exist. */
  updateRole(id: string, role: ProjectRole): Promise<ProjectMember | null>;
  /** Remove a member by id. Returns true when a row was deleted, false when not found. */
  delete(id: string): Promise<boolean>;
}

// ─── Mapper ────────────────────────────────────────────────────

type PrismaMember = {
  id: string;
  projectId: string;
  userId: string;
  email: string;
  role: ProjectRole;
  invitedBy: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toAppModel(record: PrismaMember): ProjectMember {
  return {
    id: record.id,
    projectId: record.projectId,
    userId: record.userId,
    email: record.email,
    role: record.role,
    invitedBy: record.invitedBy,
    acceptedAt: record.acceptedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ─── Factory ───────────────────────────────────────────────────

/** Prisma-backed MemberRepository. */
export function createMemberRepository(prisma: PrismaClient): MemberRepository {
  return {
    async findByProjectId(projectId) {
      const records = await prisma.projectMember.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(toAppModel);
    },

    async findByEmail(projectId, email) {
      const record = await prisma.projectMember.findUnique({
        where: { projectId_email: { projectId, email } },
      });
      return record ? toAppModel(record) : null;
    },

    async upsert(input) {
      const userId = input.userId ?? input.email;
      const record = await prisma.projectMember.upsert({
        where: { projectId_email: { projectId: input.projectId, email: input.email } },
        create: {
          projectId: input.projectId,
          email: input.email,
          userId,
          role: input.role,
          invitedBy: input.invitedBy ?? null,
        },
        update: {
          role: input.role,
          ...(input.invitedBy !== undefined && { invitedBy: input.invitedBy }),
        },
      });
      return toAppModel(record);
    },

    async updateRole(id, role) {
      try {
        const record = await prisma.projectMember.update({
          where: { id },
          data: { role },
        });
        return toAppModel(record);
      } catch {
        return null;
      }
    },

    async delete(id) {
      try {
        await prisma.projectMember.delete({ where: { id } });
        return true;
      } catch {
        return false;
      }
    },
  };
}
