/**
 * Contact routes — CRUD for contacts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';

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
  metadata: z.record(z.unknown()).optional(),
});

const listQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
});

// ─── Route Registration ─────────────────────────────────────────

export async function contactRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): Promise<void> {
  const { contactRepository } = deps;

  // ─── List Contacts ──────────────────────────────────────────────

  fastify.get(
    '/projects/:projectId/contacts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = listQuerySchema.parse(request.query);

      const contacts = await contactRepository.list(projectId, {
        limit: query.limit,
        offset: query.offset,
      });

      return reply.send({ contacts });
    },
  );

  // ─── Get Contact ────────────────────────────────────────────────

  fastify.get(
    '/contacts/:contactId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId } = request.params as { contactId: string };

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

      const contact = await contactRepository.create(parseResult.data);

      return reply.status(201).send({ contact });
    },
  );

  // ─── Update Contact ─────────────────────────────────────────────

  fastify.patch(
    '/contacts/:contactId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { contactId } = request.params as { contactId: string };

      const parseResult = updateContactSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const contact = await contactRepository.update(contactId, parseResult.data);
        return reply.send({ contact });
      } catch (error) {
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
        await contactRepository.delete(contactId);
        return reply.status(204).send();
      } catch (error) {
        // Prisma throws if record not found
        return reply.status(404).send({ error: 'Contact not found' });
      }
    },
  );
}
