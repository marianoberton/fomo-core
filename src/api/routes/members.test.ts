/**
 * Members route tests — A3 RBAC.
 *
 * Uses a lightweight Fastify server with mocked MemberRepository — no DB needed.
 *
 * Auth strategy per test category:
 *   - Role-check tests: empty API key (auth disabled) + x-user-email header.
 *     This keeps `request.apiKeyProjectId === undefined` so `requireProjectRole`
 *     exercises the member-lookup path, not the master-key bypass.
 *   - Master-key bypass tests: inject `apiKeyProjectId = null` via onRequest hook.
 *   - Project-scoped key tests: inject `apiKeyProjectId = PROJECT_ID` via onRequest hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ProjectRole } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';
import { memberRoutes } from './members.js';
import type { MemberRepository, ProjectMember } from '@/infrastructure/repositories/member-repository.js';
import type { RouteDependencies } from '@/api/types.js';

// ─── Constants ─────────────────────────────────────────────────

const PROJECT_ID = 'proj-abc';

// ─── Fixtures ──────────────────────────────────────────────────

function makeMember(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    id: 'mem-1',
    projectId: PROJECT_ID,
    userId: 'alice@example.com',
    email: 'alice@example.com',
    role: 'owner',
    invitedBy: null,
    acceptedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Mock repo factory ─────────────────────────────────────────

type MockFns = { [K in keyof MemberRepository]: ReturnType<typeof vi.fn> };

function makeMockRepo(members: ProjectMember[] = []): {
  repo: MemberRepository;
  fns: MockFns;
} {
  const arr = [...members];
  const findByProjectId = vi.fn().mockImplementation(() => Promise.resolve([...arr]));
  const findByEmail = vi.fn().mockImplementation((_pid: string, email: string) =>
    Promise.resolve(arr.find((m) => m.email === email) ?? null),
  );
  const upsert = vi.fn().mockImplementation((input: { projectId: string; email: string; role: ProjectRole }) => {
    const existing = arr.find((m) => m.email === input.email);
    if (existing) {
      existing.role = input.role;
      return Promise.resolve(existing);
    }
    const m = makeMember({ email: input.email, role: input.role });
    arr.push(m);
    return Promise.resolve(m);
  });
  const updateRole = vi.fn().mockImplementation((id: string, role: ProjectRole) => {
    const m = arr.find((m) => m.id === id);
    if (!m) return Promise.resolve(null);
    m.role = role;
    return Promise.resolve(m);
  });
  const deleteFn = vi.fn().mockImplementation((id: string) => {
    const idx = arr.findIndex((m) => m.id === id);
    if (idx === -1) return Promise.resolve(false);
    arr.splice(idx, 1);
    return Promise.resolve(true);
  });

  const repo: MemberRepository = {
    findByProjectId,
    findByEmail,
    upsert,
    updateRole,
    delete: deleteFn,
  };

  return { repo, fns: { findByProjectId, findByEmail, upsert, updateRole, delete: deleteFn } };
}

// ─── Server builder ────────────────────────────────────────────
// Auth is disabled (no API key middleware). Role checks run purely via
// x-user-email → member lookup. For bypass tests, use `buildBypassServer`.

async function buildServer(
  members: ProjectMember[] = [],
): Promise<{ server: FastifyInstance; fns: MockFns }> {
  const logger = createLogger();
  const server = Fastify({ logger: false });
  const { repo, fns } = makeMockRepo(members);

  await server.register(
    async (prefixed) => {
      await prefixed.register(memberRoutes, { memberRepository: repo, logger } as unknown as RouteDependencies);
    },
    { prefix: '/api/v1' },
  );

  await server.ready();
  return { server, fns };
}

/** Server that injects `apiKeyProjectId` directly — for bypass tests. */
async function buildBypassServer(
  members: ProjectMember[],
  apiKeyProjectId: string | null,
): Promise<{ server: FastifyInstance; fns: MockFns }> {
  const logger = createLogger();
  const server = Fastify({ logger: false });
  const { repo, fns } = makeMockRepo(members);

  await server.register(
    async (prefixed) => {
      prefixed.addHook('onRequest', async (req) => { req.apiKeyProjectId = apiKeyProjectId; });
      await prefixed.register(memberRoutes, { memberRepository: repo, logger } as unknown as RouteDependencies);
    },
    { prefix: '/api/v1' },
  );

  await server.ready();
  return { server, fns };
}

// ─── Header helpers ─────────────────────────────────────────────

function asUser(email: string): Record<string, string> {
  return { 'x-user-email': email };
}

// ─── POST /projects/:projectId/members ─────────────────────────

describe('POST /projects/:projectId/members', () => {
  let server: FastifyInstance;
  let fns: MockFns;

  beforeEach(async () => {
    const result = await buildServer([makeMember({ role: 'owner' })]);
    server = result.server;
    fns = result.fns;
  });

  afterEach(async () => { await server.close(); });

  it('owner creates a new member → 201 with member shape', async () => {
    fns.findByEmail
      .mockResolvedValueOnce(makeMember({ role: 'owner' })) // middleware lookup (owner confirmed)
      .mockResolvedValueOnce(null); // handler: "is this existing?" → no
    const newMember = makeMember({ id: 'mem-2', email: 'bob@example.com', role: 'operator' });
    fns.upsert.mockResolvedValueOnce(newMember);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
      payload: { email: 'bob@example.com', role: 'operator' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ success: boolean; data: { member: { email: string; role: string } } }>();
    expect(body.success).toBe(true);
    expect(body.data.member.email).toBe('bob@example.com');
    expect(body.data.member.role).toBe('operator');
  });

  it('POST with existing (projectId, email) returns 200 (idempotent, not 409)', async () => {
    const existing = makeMember({ email: 'alice@example.com', role: 'owner' });
    fns.findByEmail
      .mockResolvedValueOnce(existing) // middleware lookup
      .mockResolvedValueOnce(existing); // handler: "is this existing?" → yes
    fns.upsert.mockResolvedValueOnce({ ...existing, role: 'operator' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
      payload: { email: 'alice@example.com', role: 'operator' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('validates body: email must be a valid email', async () => {
    fns.findByEmail.mockResolvedValueOnce(makeMember({ role: 'owner' })); // middleware

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
      payload: { email: 'not-an-email', role: 'viewer' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('validates body: role must be one of owner|operator|viewer', async () => {
    fns.findByEmail.mockResolvedValueOnce(makeMember({ role: 'owner' })); // middleware

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
      payload: { email: 'bob@example.com', role: 'superadmin' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lowercases and trims email before upsert', async () => {
    fns.findByEmail
      .mockResolvedValueOnce(makeMember({ role: 'owner' })) // middleware
      .mockResolvedValueOnce(null); // handler: not existing
    const newMember = makeMember({ email: 'bob@example.com', role: 'viewer' });
    fns.upsert.mockResolvedValueOnce(newMember);

    await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
      payload: { email: '  BOB@EXAMPLE.COM  ', role: 'viewer' },
    });

    expect(fns.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'bob@example.com' }),
    );
  });

  it('operator gets 403 — insufficient role for POST (owner required)', async () => {
    const { server: s, fns: f } = await buildServer([makeMember({ role: 'operator' })]);
    f.findByEmail.mockResolvedValueOnce(makeMember({ role: 'operator' })); // middleware lookup

    const res = await s.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
      payload: { email: 'bob@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
    await s.close();
  });

  it('viewer gets 403 — insufficient role for POST', async () => {
    const { server: s, fns: f } = await buildServer([makeMember({ role: 'viewer' })]);
    f.findByEmail.mockResolvedValueOnce(makeMember({ role: 'viewer' })); // middleware lookup

    const res = await s.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
      payload: { email: 'bob@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
    await s.close();
  });

  it('non-member email → 403', async () => {
    fns.findByEmail.mockResolvedValueOnce(null); // middleware: stranger not found

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('stranger@example.com'),
      payload: { email: 'bob@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('master key can create members for any project', async () => {
    const { server: s, fns: f } = await buildBypassServer([makeMember({ role: 'owner' })], null);
    f.findByEmail.mockResolvedValueOnce(null); // handler: not existing
    const newMember = makeMember({ email: 'bob@example.com', role: 'viewer' });
    f.upsert.mockResolvedValueOnce(newMember);

    const res = await s.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      payload: { email: 'bob@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(201);
    await s.close();
  });

  it('response does not include invitedBy or userId', async () => {
    fns.findByEmail
      .mockResolvedValueOnce(makeMember({ role: 'owner' })) // middleware
      .mockResolvedValueOnce(null); // handler: not existing
    const newMember = makeMember({ email: 'bob@example.com', role: 'viewer', invitedBy: 'alice@example.com' });
    fns.upsert.mockResolvedValueOnce(newMember);

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
      payload: { email: 'bob@example.com', role: 'viewer' },
    });

    const body = res.json<{ data: { member: Record<string, unknown> } }>();
    expect(body.data.member).not.toHaveProperty('invitedBy');
    expect(body.data.member).not.toHaveProperty('userId');
  });

  it('project API key for same project acts as owner', async () => {
    const { server: s, fns: f } = await buildBypassServer([makeMember({ role: 'owner' })], PROJECT_ID);
    f.findByEmail.mockResolvedValueOnce(null);
    const newMember = makeMember({ email: 'bob@example.com', role: 'viewer' });
    f.upsert.mockResolvedValueOnce(newMember);

    const res = await s.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      payload: { email: 'bob@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(201);
    await s.close();
  });
});

// ─── GET /projects/:projectId/members ──────────────────────────

describe('GET /projects/:projectId/members', () => {
  it('viewer can list members → 200', async () => {
    const { server, fns } = await buildServer([makeMember({ role: 'viewer' })]);
    fns.findByEmail.mockResolvedValueOnce(makeMember({ role: 'viewer' })); // middleware
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('operator can list members → 200', async () => {
    const { server, fns } = await buildServer([makeMember({ role: 'operator' })]);
    fns.findByEmail.mockResolvedValueOnce(makeMember({ role: 'operator' })); // middleware
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('owner can list members → 200', async () => {
    const { server, fns } = await buildServer([makeMember({ role: 'owner' })]);
    fns.findByEmail.mockResolvedValueOnce(makeMember({ role: 'owner' })); // middleware
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('non-member email → 403', async () => {
    const { server, fns } = await buildServer([makeMember({ role: 'owner' })]);
    fns.findByEmail.mockResolvedValueOnce(null); // middleware: stranger not found

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('stranger@example.com'),
    });
    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('response shape: members array with id, email, role, createdAt — no invitedBy / userId', async () => {
    const member = makeMember({ role: 'owner', invitedBy: 'someone@example.com' });
    const { server, fns } = await buildServer([member]);
    fns.findByEmail.mockResolvedValueOnce(member); // middleware
    fns.findByProjectId.mockResolvedValueOnce([member]); // handler

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { members: Array<Record<string, unknown>> } }>();
    expect(body.data.members).toHaveLength(1);
    const m = body.data.members[0];
    expect(m).toHaveProperty('id');
    expect(m).toHaveProperty('email');
    expect(m).toHaveProperty('role');
    expect(m).toHaveProperty('createdAt');
    expect(m).not.toHaveProperty('invitedBy');
    expect(m).not.toHaveProperty('userId');
    await server.close();
  });

  it('result order comes from findByProjectId (createdAt desc by repo contract)', async () => {
    const a = makeMember({ id: 'mem-a', email: 'a@x.com', createdAt: new Date('2026-01-02') });
    const b = makeMember({ id: 'mem-b', email: 'b@x.com', createdAt: new Date('2026-01-01') });
    const { server, fns } = await buildServer([a]);
    fns.findByEmail.mockResolvedValueOnce(a); // middleware
    fns.findByProjectId.mockResolvedValueOnce([a, b]);

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/members`,
      headers: asUser('a@x.com'),
    });
    const body = res.json<{ data: { members: Array<{ id: string }> } }>();
    expect(body.data.members[0]?.id).toBe('mem-a');
    await server.close();
  });
});

// ─── PATCH /projects/:projectId/members/:id ────────────────────

describe('PATCH /projects/:projectId/members/:id', () => {
  it('owner can change a member role → 200', async () => {
    const owner = makeMember({ id: 'mem-o', email: 'alice@example.com', role: 'owner' });
    const target = makeMember({ id: 'mem-t', email: 'bob@example.com', role: 'viewer' });
    const { server, fns } = await buildServer([owner, target]);
    fns.findByEmail.mockResolvedValueOnce(owner); // middleware
    fns.updateRole.mockResolvedValueOnce({ ...target, role: 'operator' });

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${PROJECT_ID}/members/mem-t`,
      headers: asUser('alice@example.com'),
      payload: { role: 'operator' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { member: { role: string } } }>();
    expect(body.data.member.role).toBe('operator');
    await server.close();
  });

  it('operator gets 403', async () => {
    const op = makeMember({ role: 'operator' });
    const { server, fns } = await buildServer([op]);
    fns.findByEmail.mockResolvedValueOnce(op); // middleware

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${PROJECT_ID}/members/mem-1`,
      headers: asUser('alice@example.com'),
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('viewer gets 403', async () => {
    const viewer = makeMember({ role: 'viewer' });
    const { server, fns } = await buildServer([viewer]);
    fns.findByEmail.mockResolvedValueOnce(viewer); // middleware

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${PROJECT_ID}/members/mem-1`,
      headers: asUser('alice@example.com'),
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('unknown member id → 404', async () => {
    const owner = makeMember({ role: 'owner' });
    const { server, fns } = await buildServer([owner]);
    fns.findByEmail.mockResolvedValueOnce(owner); // middleware
    fns.updateRole.mockResolvedValueOnce(null);

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${PROJECT_ID}/members/does-not-exist`,
      headers: asUser('alice@example.com'),
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(404);
    await server.close();
  });

  it('invalid role → 400', async () => {
    const owner = makeMember({ role: 'owner' });
    const { server, fns } = await buildServer([owner]);
    fns.findByEmail.mockResolvedValueOnce(owner); // middleware

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${PROJECT_ID}/members/mem-1`,
      headers: asUser('alice@example.com'),
      payload: { role: 'god' },
    });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});

// ─── DELETE /projects/:projectId/members/:id ───────────────────

describe('DELETE /projects/:projectId/members/:id', () => {
  it('owner can delete a non-owner member → 200', async () => {
    const owner = makeMember({ id: 'mem-o', email: 'alice@example.com', role: 'owner' });
    const target = makeMember({ id: 'mem-t', email: 'bob@example.com', role: 'viewer' });
    const { server, fns } = await buildServer([owner, target]);
    fns.findByEmail.mockResolvedValueOnce(owner); // middleware
    fns.findByProjectId.mockResolvedValueOnce([owner, target]); // DELETE handler
    fns.delete.mockResolvedValueOnce(true);

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${PROJECT_ID}/members/mem-t`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('operator gets 403', async () => {
    const op = makeMember({ role: 'operator' });
    const { server, fns } = await buildServer([op]);
    fns.findByEmail.mockResolvedValueOnce(op); // middleware

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${PROJECT_ID}/members/mem-1`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('viewer gets 403', async () => {
    const viewer = makeMember({ role: 'viewer' });
    const { server, fns } = await buildServer([viewer]);
    fns.findByEmail.mockResolvedValueOnce(viewer); // middleware

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${PROJECT_ID}/members/mem-1`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('unknown member id → 404', async () => {
    const owner = makeMember({ role: 'owner' });
    const { server, fns } = await buildServer([owner]);
    fns.findByEmail.mockResolvedValueOnce(owner); // middleware
    fns.findByProjectId.mockResolvedValueOnce([]); // handler: target not in list

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${PROJECT_ID}/members/does-not-exist`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(404);
    await server.close();
  });

  it('deleting the last owner → 409 LAST_OWNER_CANNOT_BE_REMOVED', async () => {
    const owner = makeMember({ id: 'mem-o', email: 'alice@example.com', role: 'owner' });
    const { server, fns } = await buildServer([owner]);
    fns.findByEmail.mockResolvedValueOnce(owner); // middleware
    fns.findByProjectId.mockResolvedValueOnce([owner]); // only one owner

    const res = await server.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${PROJECT_ID}/members/mem-o`,
      headers: asUser('alice@example.com'),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ success: boolean; error: { code: string; message: string } }>();
    expect(body.error.code).toBe('LAST_OWNER_CANNOT_BE_REMOVED');
    expect(body.error.message).toContain('último owner');
    await server.close();
  });
});
