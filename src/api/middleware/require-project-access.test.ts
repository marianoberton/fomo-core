/**
 * Unit tests for the project-access middleware helpers.
 *
 * Covers:
 *   - Master key (apiKeyProjectId === null) passes every check
 *   - Scoped key matching the resource's projectId passes
 *   - Scoped key mismatching the resource's projectId → 403
 *   - Missing resource → 404
 */
import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  requireProjectAccess,
  requireSessionAccess,
  requireApprovalAccess,
  requireTraceAccess,
  ProjectAccessDeniedError,
  ResourceNotFoundError,
} from './require-project-access.js';

function makeRequest(apiKeyProjectId: string | null | undefined): FastifyRequest {
  return { apiKeyProjectId } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply & { code: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } {
  const reply = {
    code: vi.fn(function (this: unknown) { return this; }),
    send: vi.fn().mockResolvedValue(undefined),
  };
  (reply.code as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(reply);
  return reply as unknown as FastifyReply & {
    code: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

describe('requireProjectAccess', () => {
  it('master key (null) passes', async () => {
    const reply = makeReply();
    await expect(
      requireProjectAccess(makeRequest(null), reply, 'proj-a'),
    ).resolves.toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('undefined key (auth disabled) passes', async () => {
    const reply = makeReply();
    await expect(
      requireProjectAccess(makeRequest(undefined), reply, 'proj-a'),
    ).resolves.toBeUndefined();
  });

  it('scoped key matching passes', async () => {
    const reply = makeReply();
    await expect(
      requireProjectAccess(makeRequest('proj-a'), reply, 'proj-a'),
    ).resolves.toBeUndefined();
  });

  it('scoped key mismatching → 403 + throws ProjectAccessDeniedError', async () => {
    const reply = makeReply();
    await expect(
      requireProjectAccess(makeRequest('proj-a'), reply, 'proj-b'),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalled();
  });
});

describe('requireSessionAccess', () => {
  it('master key passes when session exists', async () => {
    const prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({ projectId: 'proj-a' }),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireSessionAccess(makeRequest(null), reply, 'sess-1', prisma),
    ).resolves.toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('scoped key with matching project passes', async () => {
    const prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({ projectId: 'proj-a' }),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireSessionAccess(makeRequest('proj-a'), reply, 'sess-1', prisma),
    ).resolves.toBeUndefined();
  });

  it('scoped key with mismatched project → 403', async () => {
    const prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue({ projectId: 'proj-b' }),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireSessionAccess(makeRequest('proj-a'), reply, 'sess-1', prisma),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('missing session → 404 + throws ResourceNotFoundError', async () => {
    const prisma = {
      session: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireSessionAccess(makeRequest(null), reply, 'nope', prisma),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(reply.code).toHaveBeenCalledWith(404);
  });
});

describe('requireApprovalAccess', () => {
  it('scoped key mismatch → 403', async () => {
    const prisma = {
      approvalRequest: {
        findUnique: vi.fn().mockResolvedValue({ projectId: 'proj-b' }),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireApprovalAccess(makeRequest('proj-a'), reply, 'appr-1', prisma),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('master key passes', async () => {
    const prisma = {
      approvalRequest: {
        findUnique: vi.fn().mockResolvedValue({ projectId: 'proj-b' }),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireApprovalAccess(makeRequest(null), reply, 'appr-1', prisma),
    ).resolves.toBeUndefined();
  });

  it('missing approval → 404', async () => {
    const prisma = {
      approvalRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireApprovalAccess(makeRequest('proj-a'), reply, 'nope', prisma),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(reply.code).toHaveBeenCalledWith(404);
  });
});

describe('requireTraceAccess', () => {
  it('scoped key mismatch → 403', async () => {
    const prisma = {
      executionTrace: {
        findUnique: vi.fn().mockResolvedValue({ projectId: 'proj-b' }),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireTraceAccess(makeRequest('proj-a'), reply, 'trace-1', prisma),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it('missing trace → 404', async () => {
    const prisma = {
      executionTrace: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    const reply = makeReply();
    await expect(
      requireTraceAccess(makeRequest('proj-a'), reply, 'nope', prisma),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
