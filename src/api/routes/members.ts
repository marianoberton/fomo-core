/**
 * Project member (RBAC) routes.
 *
 * Endpoints (all scoped to `/projects/:projectId/members`):
 *   GET    /                 → list members            [viewer]
 *   POST   /                 → invite / upsert member  [owner]
 *   PATCH  /:id              → change role             [owner]
 *   DELETE /:id              → remove member           [owner]
 *
 * Auth: role enforcement runs via `requireProjectRole` attached as a
 * per-route preHandler inside a scoped `register()` so it cannot
 * bleed into sibling plugins (see CLAUDE.md "Fastify Hook Scope Rule").
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ProjectRole } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { requireProjectRole } from '../auth-middleware.js';
import type { ProjectMember } from '@/infrastructure/repositories/member-repository.js';

// ─── Zod schemas ───────────────────────────────────────────────

const roleSchema = z.enum(['owner', 'operator', 'viewer']);

const paramsSchema = z.object({
  projectId: z.string().min(1),
});

const memberParamsSchema = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
});

const createMemberSchema = z.object({
  email: z.string().transform((v) => v.trim().toLowerCase()).pipe(z.string().email().max(254)),
  role: roleSchema,
});

const updateRoleSchema = z.object({
  role: roleSchema,
});

// ─── Response shaping ──────────────────────────────────────────

/** Safe member shape returned to callers — no sensitive internal fields. */
interface MemberResponse {
  id: string;
  projectId: string;
  email: string;
  role: ProjectRole;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toResponse(m: ProjectMember): MemberResponse {
  return {
    id: m.id,
    projectId: m.projectId,
    email: m.email,
    role: m.role,
    acceptedAt: m.acceptedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

// ─── Route registration ────────────────────────────────────────

/**
 * Register member routes. Wrapped in `register()` so the per-route
 * preHandler hooks are scoped only to this sub-plugin.
 */
export async function memberRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): Promise<void> {
  const { logger, memberRepository } = deps;

  await fastify.register(async (scoped: FastifyInstance) => {

    // ─── GET /projects/:projectId/members — viewer+ ────────────
    scoped.get(
      '/projects/:projectId/members',
      {
        preHandler: requireProjectRole('viewer', { memberRepository, logger }),
      },
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const parsed = paramsSchema.safeParse(request.params);
        if (!parsed.success) {
          await sendError(reply, 'VALIDATION_ERROR', 'Invalid params', 400);
          return;
        }
        const { projectId } = parsed.data;
        const members = await memberRepository.findByProjectId(projectId);
        await sendSuccess(reply, { members: members.map(toResponse) });
      },
    );

    // ─── POST /projects/:projectId/members — owner ─────────────
    // Idempotent: if (projectId, email) already exists, update the role
    // and return 200; if it is new, create it and return 201.
    scoped.post(
      '/projects/:projectId/members',
      {
        preHandler: requireProjectRole('owner', { memberRepository, logger }),
      },
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const paramsParsed = paramsSchema.safeParse(request.params);
        if (!paramsParsed.success) {
          await sendError(reply, 'VALIDATION_ERROR', 'Invalid params', 400);
          return;
        }
        const bodyParsed = createMemberSchema.safeParse(request.body);
        if (!bodyParsed.success) {
          await sendError(reply, 'VALIDATION_ERROR', 'Invalid body', 400);
          return;
        }

        const { projectId } = paramsParsed.data;
        const { email, role } = bodyParsed.data;

        // Determine if this is a create or an update so we can return the
        // correct status code.
        const existing = await memberRepository.findByEmail(projectId, email);

        const callerEmail = request.headers['x-user-email'];
        const invitedBy = Array.isArray(callerEmail) ? (callerEmail[0] ?? null) : (callerEmail ?? null);

        const member = await memberRepository.upsert({ projectId, email, role, invitedBy });

        const statusCode = existing ? 200 : 201;
        await sendSuccess(reply, { member: toResponse(member) }, statusCode);
      },
    );

    // ─── PATCH /projects/:projectId/members/:id — owner ────────
    scoped.patch(
      '/projects/:projectId/members/:id',
      {
        preHandler: requireProjectRole('owner', { memberRepository, logger }),
      },
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const paramsParsed = memberParamsSchema.safeParse(request.params);
        if (!paramsParsed.success) {
          await sendError(reply, 'VALIDATION_ERROR', 'Invalid params', 400);
          return;
        }
        const bodyParsed = updateRoleSchema.safeParse(request.body);
        if (!bodyParsed.success) {
          await sendError(reply, 'VALIDATION_ERROR', 'Invalid body', 400);
          return;
        }

        const { id } = paramsParsed.data;
        const { role } = bodyParsed.data;

        const member = await memberRepository.updateRole(id, role);
        if (!member) {
          await sendNotFound(reply, 'ProjectMember', id);
          return;
        }
        await sendSuccess(reply, { member: toResponse(member) });
      },
    );

    // ─── DELETE /projects/:projectId/members/:id — owner ───────
    scoped.delete(
      '/projects/:projectId/members/:id',
      {
        preHandler: requireProjectRole('owner', { memberRepository, logger }),
      },
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const parsed = memberParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          await sendError(reply, 'VALIDATION_ERROR', 'Invalid params', 400);
          return;
        }

        const { projectId, id } = parsed.data;

        // Last-owner guard: prevent removing the sole owner of a project.
        const allMembers = await memberRepository.findByProjectId(projectId);
        const target = allMembers.find((m) => m.id === id);
        if (!target) {
          await sendNotFound(reply, 'ProjectMember', id);
          return;
        }
        if (target.role === 'owner') {
          const ownerCount = allMembers.filter((m) => m.role === 'owner').length;
          if (ownerCount <= 1) {
            await sendError(
              reply,
              'LAST_OWNER_CANNOT_BE_REMOVED',
              'No podés borrar al último owner. Asigná otro owner primero.',
              409,
            );
            return;
          }
        }

        const deleted = await memberRepository.delete(id);
        if (!deleted) {
          await sendNotFound(reply, 'ProjectMember', id);
          return;
        }
        await sendSuccess(reply, { success: true });
      },
    );
  });
}
