/**
 * Tests for project access guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { requireProjectAccess } from './project-access.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

function createMockRequest(overrides: {
  apiKeyProjectId?: string | null;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}): FastifyRequest {
  return {
    apiKeyProjectId: overrides.apiKeyProjectId,
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    query: overrides.query ?? {},
  } as unknown as FastifyRequest;
}

function createMockReply(): FastifyReply & { sentStatus: number | null; sentBody: unknown } {
  const reply = {
    sentStatus: null as number | null,
    sentBody: null as unknown,
    code(status: number) {
      reply.sentStatus = status;
      return reply;
    },
    send(body: unknown) {
      reply.sentBody = body;
      return Promise.resolve();
    },
  };
  return reply as unknown as FastifyReply & { sentStatus: number | null; sentBody: unknown };
}

describe('requireProjectAccess', () => {
  it('allows master key (null) access to any project', async () => {
    const request = createMockRequest({
      apiKeyProjectId: null,
      params: { projectId: 'project-123' },
    });
    const reply = createMockReply();

    await requireProjectAccess(request, reply);

    expect(reply.sentStatus).toBeNull(); // no response sent = allowed
  });

  it('allows unauthenticated (undefined) request through', async () => {
    const request = createMockRequest({
      apiKeyProjectId: undefined,
      params: { projectId: 'project-123' },
    });
    const reply = createMockReply();

    await requireProjectAccess(request, reply);

    expect(reply.sentStatus).toBeNull();
  });

  it('allows project-scoped key access to its own project', async () => {
    const request = createMockRequest({
      apiKeyProjectId: 'project-123',
      params: { projectId: 'project-123' },
    });
    const reply = createMockReply();

    await requireProjectAccess(request, reply);

    expect(reply.sentStatus).toBeNull();
  });

  it('blocks project-scoped key from accessing another project', async () => {
    const request = createMockRequest({
      apiKeyProjectId: 'project-123',
      params: { projectId: 'project-456' },
    });
    const reply = createMockReply();

    await requireProjectAccess(request, reply);

    expect(reply.sentStatus).toBe(403);
    expect(reply.sentBody).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PROJECT_ACCESS_DENIED',
        }),
      }),
    );
  });

  it('extracts projectId from body when not in params', async () => {
    const request = createMockRequest({
      apiKeyProjectId: 'project-123',
      body: { projectId: 'project-456' },
    });
    const reply = createMockReply();

    await requireProjectAccess(request, reply);

    expect(reply.sentStatus).toBe(403);
  });

  it('extracts projectId from query when not in params or body', async () => {
    const request = createMockRequest({
      apiKeyProjectId: 'project-123',
      query: { projectId: 'project-123' },
    });
    const reply = createMockReply();

    await requireProjectAccess(request, reply);

    expect(reply.sentStatus).toBeNull(); // allowed — same project
  });

  it('allows through when no projectId in request at all', async () => {
    const request = createMockRequest({
      apiKeyProjectId: 'project-123',
    });
    const reply = createMockReply();

    await requireProjectAccess(request, reply);

    expect(reply.sentStatus).toBeNull(); // route has no project scope — allow
  });
});
