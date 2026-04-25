/**
 * Contact bulk-import endpoint tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { contactRoutes } from './contacts.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

interface MockPrismaContact {
  contact: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function createApp(): { app: FastifyInstance; prisma: MockPrismaContact } {
  const prisma: MockPrismaContact = {
    contact: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const deps = { ...createMockDeps(), prisma: prisma as unknown as ReturnType<typeof createMockDeps>['prisma'] };
  const app = Fastify();
  app.addHook('onRequest', async (request) => { request.apiKeyProjectId = null; });
  registerErrorHandler(app);
  contactRoutes(app, deps);
  return { app, prisma };
}

describe('POST /projects/:projectId/contacts/bulk-import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates new contacts and updates existing ones', async () => {
    const { app, prisma } = createApp();
    prisma.contact.findUnique
      .mockResolvedValueOnce(null) // first is new
      .mockResolvedValueOnce({ id: 'existing' }); // second exists
    prisma.contact.create.mockResolvedValue({ id: 'new' });
    prisma.contact.update.mockResolvedValue({ id: 'existing' });

    const response = await app.inject({
      method: 'POST',
      url: '/projects/p1/contacts/bulk-import',
      payload: {
        contacts: [
          { name: 'Juan', phone: '+5491111' },
          { name: 'Ana', phone: '+5492222' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { created: number; updated: number; errors: unknown[] } }>();
    expect(body.data.created).toBe(1);
    expect(body.data.updated).toBe(1);
    expect(body.data.errors).toEqual([]);
  });

  it('collects per-row errors without failing whole request', async () => {
    const { app } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/projects/p1/contacts/bulk-import',
      payload: {
        contacts: [
          { name: 'Valid', phone: '+5491111' },
          { name: 'NoId' }, // missing phone/email/etc
          { phone: '+54' }, // missing name
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { errors: { index: number }[] } }>();
    expect(body.data.errors.length).toBeGreaterThanOrEqual(2);
    const indices = body.data.errors.map((e) => e.index).sort();
    expect(indices).toContain(1);
    expect(indices).toContain(2);
  });

  it('rejects when more than 5000 contacts', async () => {
    const { app } = createApp();
    const contacts = Array.from({ length: 5001 }, (_, i) => ({
      name: `C${i}`,
      phone: `+5499${i}`,
    }));
    const response = await app.inject({
      method: 'POST',
      url: '/projects/p1/contacts/bulk-import',
      payload: { contacts },
    });
    expect(response.statusCode).toBe(400);
  });
});
