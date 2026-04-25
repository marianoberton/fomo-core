/**
 * Contact routes — CRUD for contacts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { RouteDependencies } from '../types.js';
import type { ProjectId } from '@/core/types.js';
import { sendSuccess, sendError } from '../error-handler.js';
import { requireProjectRole } from '../auth-middleware.js';
import { paginationSchema, paginate } from '../pagination.js';
import {
  requireContactAccess,
  ProjectAccessDeniedError,
  ResourceNotFoundError,
} from '../middleware/require-project-access.js';

// ─── Schemas ────────────────────────────────────────────────────

const createContactSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  telegramId: z.string().optional(),
  slackId: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  role: z.string().max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateContactSchema = z.object({
  name: z.string().min(1).optional(),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  telegramId: z.string().optional(),
  slackId: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  role: z.string().max(50).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Bulk import ────────────────────────────────────────────────

const bulkContactSchema = z.object({
  name: z.string().min(1).max(200),
  displayName: z.string().max(200).optional(),
  phone: z.string().min(1).max(50).optional(),
  email: z.string().email().max(200).optional(),
  telegramId: z.string().max(100).optional(),
  slackId: z.string().max(100).optional(),
  timezone: z.string().max(100).optional(),
  language: z.string().max(20).optional(),
  role: z.string().max(50).optional(),
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const bulkImportSchema = z.object({
  contacts: z.array(z.unknown()).max(5000),
});

// listQuerySchema replaced by paginationSchema from pagination.ts

// ─── Route Registration ─────────────────────────────────────────

export function contactRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { contactRepository, memberRepository, logger } = deps;
  const rbacOperator = requireProjectRole('operator', { memberRepository, logger });

  function isGuardError(e: unknown): boolean {
    return e instanceof ProjectAccessDeniedError || e instanceof ResourceNotFoundError;
  }

  // ─── List Contacts ──────────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/contacts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = paginationSchema.parse(request.query);

      const contacts = await contactRepository.list(projectId as ProjectId, {
        limit: query.limit,
        offset: query.offset,
      });

      return sendSuccess(reply, paginate(contacts, query.limit, query.offset));
    },
  );

  // ─── Get Contact ────────────────────────────────────────────────

  fastify.get(
    '/contacts/:contactId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId } = request.params as { contactId: string };

      try {
        await requireContactAccess(request, reply, contactId, deps.prisma);
      } catch (e) {
        if (isGuardError(e)) return;
        throw e;
      }

      const contact = await contactRepository.findById(contactId);

      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found' });
      }

      return reply.send({ contact });
    },
  );

  // ─── Create Contact ─────────────────────────────────────────────

  fastify.post(
    '/contacts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createContactSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      const contact = await contactRepository.create({
        ...parseResult.data,
        projectId: parseResult.data.projectId as ProjectId,
      });

      return reply.status(201).send({ contact });
    },
  );

  // ─── Update Contact ─────────────────────────────────────────────

  fastify.patch(
    '/contacts/:contactId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId } = request.params as { contactId: string };

      try {
        await requireContactAccess(request, reply, contactId, deps.prisma);
      } catch (e) {
        if (isGuardError(e)) return;
        throw e;
      }

      const parseResult = updateContactSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const contact = await contactRepository.update(contactId, parseResult.data);
        return await reply.send({ contact });
      } catch {
        // Prisma throws if record not found
        return reply.status(404).send({ error: 'Contact not found' });
      }
    },
  );

  // ─── Delete Contact ─────────────────────────────────────────────

  fastify.delete(
    '/contacts/:contactId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId } = request.params as { contactId: string };

      try {
        await requireContactAccess(request, reply, contactId, deps.prisma);
      } catch (e) {
        if (isGuardError(e)) return;
        throw e;
      }

      try {
        await contactRepository.delete(contactId);
        return await reply.status(204).send();
      } catch {
        // Prisma throws if record not found
        return reply.status(404).send({ error: 'Contact not found' });
      }
    },
  );

  // ─── Bulk Import Contacts ───────────────────────────────────────

  fastify.post(
    '/projects/:projectId/contacts/bulk-import',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const { prisma, logger } = deps;

      const outerParsed = bulkImportSchema.safeParse(request.body);
      if (!outerParsed.success) {
        await sendError(reply, 'VALIDATION_ERROR', outerParsed.error.message, 400);
        return;
      }

      const rows = outerParsed.data.contacts;
      const errors: { index: number; reason: string }[] = [];
      const valid: { index: number; data: z.infer<typeof bulkContactSchema> }[] = [];

      rows.forEach((raw, idx) => {
        const parsed = bulkContactSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push({ index: idx, reason: parsed.error.message });
          return;
        }
        const data = parsed.data;
        if (!data.phone && !data.email && !data.telegramId && !data.slackId) {
          errors.push({ index: idx, reason: 'At least one identifier (phone/email/telegram/slack) is required' });
          return;
        }
        valid.push({ index: idx, data });
      });

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const item of valid) {
        const { data } = item;
        // Choose unique key (phone > email > telegramId > slackId)
        let where: Prisma.ContactWhereUniqueInput | null = null;
        if (data.phone) {
          where = { projectId_phone: { projectId, phone: data.phone } };
        } else if (data.email) {
          where = { projectId_email: { projectId, email: data.email } };
        } else if (data.telegramId) {
          where = { projectId_telegramId: { projectId, telegramId: data.telegramId } };
        } else if (data.slackId) {
          where = { projectId_slackId: { projectId, slackId: data.slackId } };
        }

        if (!where) {
          skipped++;
          continue;
        }

        try {
          const existing = await prisma.contact.findUnique({ where });

          const payload = {
            projectId,
            name: data.name,
            ...(data.displayName !== undefined && { displayName: data.displayName }),
            ...(data.phone !== undefined && { phone: data.phone }),
            ...(data.email !== undefined && { email: data.email }),
            ...(data.telegramId !== undefined && { telegramId: data.telegramId }),
            ...(data.slackId !== undefined && { slackId: data.slackId }),
            ...(data.timezone !== undefined && { timezone: data.timezone }),
            ...(data.language !== undefined && { language: data.language }),
            ...(data.role !== undefined && { role: data.role }),
            ...(data.tags !== undefined && { tags: data.tags }),
            ...(data.metadata !== undefined && {
              metadata: data.metadata as Prisma.InputJsonValue,
            }),
          };

          if (existing) {
            await prisma.contact.update({ where, data: payload });
            updated++;
          } else {
            await prisma.contact.create({ data: payload });
            created++;
          }
        } catch (err) {
          errors.push({
            index: item.index,
            reason: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      logger.info('Contact bulk import completed', {
        component: 'contact-routes',
        projectId,
        created,
        updated,
        skipped,
        errorCount: errors.length,
      });

      await sendSuccess(reply, { created, updated, skipped, errors });
    },
  );
}
