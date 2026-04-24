import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../error-handler.js';
import { notificationRoutes } from './notifications.js';
import { createMockDeps } from '@/testing/fixtures/routes.js';

function createApp(): {
  app: FastifyInstance;
  deps: ReturnType<typeof createMockDeps>;
} {
  const deps = createMockDeps();
  // Stub out the inAppNotification sub-client with fresh mocks for each test.
  (deps.prisma as unknown as { inAppNotification: unknown }).inAppNotification = {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  };

  const app = Fastify();
  registerErrorHandler(app);
  notificationRoutes(app, deps);
  return { app, deps };
}

const sampleNotification = {
  id: 'not-1',
  projectId: 'proj-1',
  userId: null,
  kind: 'approval_requested',
  payload: { approvalId: 'appr_123', agentName: 'Reactivadora' },
  readAt: null,
  createdAt: new Date('2026-04-24T10:00:00Z'),
};

describe('notificationRoutes', () => {
  describe('GET /projects/:projectId/notifications', () => {
    it('lists notifications for a project with pagination metadata', async () => {
      const { app, deps } = createApp();
      (deps.prisma.inAppNotification.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (deps.prisma.inAppNotification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        sampleNotification,
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/notifications',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        success: boolean;
        data: { items: { id: string; kind: string }[]; total: number; limit: number; offset: number };
      }>();
      expect(body.data.items).toHaveLength(1);
      const first = body.data.items[0]!;
      expect(first.id).toBe('not-1');
      expect(first.kind).toBe('approval_requested');
      expect(body.data.total).toBe(1);
    });

    it('filters by unread=true by applying readAt: null to the where clause', async () => {
      const { app, deps } = createApp();
      (deps.prisma.inAppNotification.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
      (deps.prisma.inAppNotification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/proj-1/notifications?unread=true',
      });
      expect(response.statusCode).toBe(200);

      const findManyMock = deps.prisma.inAppNotification.findMany as ReturnType<typeof vi.fn>;
      const findManyCall = findManyMock.mock.calls[0]!;
      const findManyArgs = findManyCall[0] as { where: Record<string, unknown> };
      expect(findManyArgs.where).toMatchObject({ projectId: 'proj-1', readAt: null });

      const countMock = deps.prisma.inAppNotification.count as ReturnType<typeof vi.fn>;
      const countCall = countMock.mock.calls[0]!;
      const countArgs = countCall[0] as { where: Record<string, unknown> };
      expect(countArgs.where).toMatchObject({ projectId: 'proj-1', readAt: null });
    });

    it('does NOT apply readAt filter when unread is absent', async () => {
      const { app, deps } = createApp();
      (deps.prisma.inAppNotification.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
      (deps.prisma.inAppNotification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/projects/proj-1/notifications' });

      const findManyMock = deps.prisma.inAppNotification.findMany as ReturnType<typeof vi.fn>;
      const findManyCall = findManyMock.mock.calls[0]!;
      const findManyArgs = findManyCall[0] as { where: Record<string, unknown> };
      expect(findManyArgs.where).not.toHaveProperty('readAt');
    });
  });

  describe('POST /projects/:projectId/notifications/:id/mark-read', () => {
    it('marks an unread notification as read and returns the updated row', async () => {
      const { app, deps } = createApp();
      (deps.prisma.inAppNotification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'not-1',
        projectId: 'proj-1',
        readAt: null,
      });
      const updated = { ...sampleNotification, readAt: new Date('2026-04-24T10:05:00Z') };
      (deps.prisma.inAppNotification.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/notifications/not-1/mark-read',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ success: boolean; data: { id: string; readAt: string | null } }>();
      expect(body.data.id).toBe('not-1');
      expect(body.data.readAt).not.toBeNull();
      expect(deps.prisma.inAppNotification.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
        where: { id: 'not-1' },
        data: { readAt: expect.any(Date) },
      });
    });

    it('is idempotent — a second mark-read does not re-write readAt', async () => {
      const { app, deps } = createApp();
      const previouslyRead = { ...sampleNotification, readAt: new Date('2026-04-24T09:00:00Z') };
      (deps.prisma.inAppNotification.findUnique as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: 'not-1', projectId: 'proj-1', readAt: new Date() })
        .mockResolvedValueOnce(previouslyRead);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/notifications/not-1/mark-read',
      });

      expect(response.statusCode).toBe(200);
      expect(deps.prisma.inAppNotification.update as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });

    it('returns 404 when the notification does not exist', async () => {
      const { app, deps } = createApp();
      (deps.prisma.inAppNotification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/notifications/missing/mark-read',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when notification belongs to another project', async () => {
      const { app, deps } = createApp();
      (deps.prisma.inAppNotification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'not-1',
        projectId: 'proj-other',
        readAt: null,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/projects/proj-1/notifications/not-1/mark-read',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ success: boolean; error: { code: string } }>();
      expect(body.error.code).toBe('NOT_IN_PROJECT');
    });
  });
});
