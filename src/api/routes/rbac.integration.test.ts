/**
 * RBAC integration tests — role × operation matrix against real Postgres.
 *
 * Covers:
 *  - viewer can GET members
 *  - viewer cannot POST/PATCH/DELETE members (403)
 *  - operator cannot POST members (403) — operator role < owner
 *  - owner can do everything (POST/PATCH/DELETE members)
 *  - master API key bypasses RBAC entirely
 *  - project-scoped API key is treated as owner (skipped — needs custom server setup)
 *  - cannot delete the last owner of a project (409)
 *  - POST member is idempotent on (projectId, email) conflict
 *
 * Auth strategy:
 *   - Role-via-email tests: `openServer` (apiKey='') + `x-user-email` header.
 *     Auth middleware is disabled → `request.apiKeyProjectId === undefined`
 *     → `requireProjectRole` exercises the member-lookup path.
 *   - Master-key bypass: `masterServer` (apiKey='master-key') + Bearer header.
 *     Auth middleware runs → `request.apiKeyProjectId === null` → RBAC bypass.
 *
 * NOTE on agent-level RBAC: agent creation routes do NOT currently have
 * `requireProjectRole`. Tests for "viewer cannot create agent" are skipped
 * and reported as a missing backend feature (BUG: no RBAC on POST /agents).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { createTestDatabase, type TestDatabase } from '@/testing/helpers/test-database.js';
import { createTestServer } from '@/testing/helpers/test-server.js';
import type { ProjectId } from '@/core/types.js';

// ─── Helpers ─────────────────────────────────────────────────────

/** Seed a ProjectMember directly in DB. Returns the member id. */
async function seedMember(
  testDb: TestDatabase,
  projectId: ProjectId,
  email: string,
  role: 'owner' | 'operator' | 'viewer',
): Promise<string> {
  const member = await testDb.prisma.projectMember.create({
    data: {
      id: nanoid(),
      projectId,
      email,
      userId: email, // email-as-userId pattern (no auth provider yet)
      role,
    },
  });
  return member.id;
}

// ─── Suite ───────────────────────────────────────────────────────

describe('RBAC role × operation matrix', () => {
  let testDb: TestDatabase;

  // openServer: auth disabled → x-user-email path exercises real RBAC
  let openServer: FastifyInstance;
  // masterServer: static bearer key → sets apiKeyProjectId=null → RBAC bypass
  let masterServer: FastifyInstance;

  let projectId: ProjectId;
  let ownerEmail: string;
  let operatorEmail: string;
  let viewerEmail: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    [openServer, masterServer] = await Promise.all([
      createTestServer({ prisma: testDb.prisma, apiKey: '' }),
      createTestServer({ prisma: testDb.prisma, apiKey: 'master-key-rbac-test' }),
    ]);
  });

  beforeEach(async () => {
    await testDb.reset();
    const seed = await testDb.seed();
    projectId = seed.projectId;

    ownerEmail = `owner-${nanoid(6)}@example.com`;
    operatorEmail = `operator-${nanoid(6)}@example.com`;
    viewerEmail = `viewer-${nanoid(6)}@example.com`;

    await Promise.all([
      seedMember(testDb, projectId, ownerEmail, 'owner'),
      seedMember(testDb, projectId, operatorEmail, 'operator'),
      seedMember(testDb, projectId, viewerEmail, 'viewer'),
    ]);
  });

  afterAll(async () => {
    await Promise.all([openServer.close(), masterServer.close()]);
    await testDb.disconnect();
  });

  // ─── viewer can GET members ────────────────────────────────────

  it('viewer can GET members', async () => {
    const res = await openServer.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { 'x-user-email': viewerEmail },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: { members: Array<{ email: string; role: string }> };
    };
    expect(Array.isArray(body.data.members)).toBe(true);
    expect(body.data.members.length).toBeGreaterThanOrEqual(3);
    expect(body.data.members.find((m) => m.email === viewerEmail)?.role).toBe('viewer');
  });

  // ─── viewer cannot POST member ────────────────────────────────

  it('viewer cannot POST member (403)', async () => {
    const res = await openServer.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { 'x-user-email': viewerEmail },
      payload: { email: 'new@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // ─── viewer cannot PATCH member role ──────────────────────────

  it('viewer cannot PATCH member role (403)', async () => {
    // First get the operator member id
    const members = await testDb.prisma.projectMember.findMany({ where: { projectId } });
    const operator = members.find((m) => m.email === operatorEmail);
    expect(operator).toBeDefined();

    const res = await openServer.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/members/${operator!.id}`,
      headers: { 'x-user-email': viewerEmail },
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── viewer cannot DELETE member ──────────────────────────────

  it('viewer cannot DELETE member (403)', async () => {
    const members = await testDb.prisma.projectMember.findMany({ where: { projectId } });
    const operator = members.find((m) => m.email === operatorEmail);

    const res = await openServer.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/members/${operator!.id}`,
      headers: { 'x-user-email': viewerEmail },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── operator cannot POST member ──────────────────────────────

  it('operator cannot POST member (403)', async () => {
    const res = await openServer.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { 'x-user-email': operatorEmail },
      payload: { email: 'another@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── owner can do everything ──────────────────────────────────

  it('owner can POST, PATCH, and DELETE members', async () => {
    const newEmail = `new-${nanoid(6)}@example.com`;

    // POST → create new member
    const postRes = await openServer.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { 'x-user-email': ownerEmail },
      payload: { email: newEmail, role: 'viewer' },
    });
    expect(postRes.statusCode).toBe(201);
    const newMemberId = (JSON.parse(postRes.body) as { data: { member: { id: string } } }).data
      .member.id;

    // PATCH → change role
    const patchRes = await openServer.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/members/${newMemberId}`,
      headers: { 'x-user-email': ownerEmail },
      payload: { role: 'operator' },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = JSON.parse(patchRes.body) as { data: { member: { role: string } } };
    expect(patched.data.member.role).toBe('operator');

    // DELETE → remove member
    const deleteRes = await openServer.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/members/${newMemberId}`,
      headers: { 'x-user-email': ownerEmail },
    });
    expect(deleteRes.statusCode).toBe(200);

    // Verify member is gone from DB
    const gone = await testDb.prisma.projectMember.findUnique({ where: { id: newMemberId } });
    expect(gone).toBeNull();
  });

  // ─── master API key bypasses RBAC ────────────────────────────

  it('master API key bypasses RBAC — viewer-restricted ops succeed', async () => {
    const MASTER_AUTH = 'Bearer master-key-rbac-test';

    // GET members — would require viewer role, master key bypasses
    const getRes = await masterServer.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { authorization: MASTER_AUTH },
    });
    expect(getRes.statusCode).toBe(200);

    // POST member — would require owner role, master key bypasses
    const postRes = await masterServer.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { authorization: MASTER_AUTH },
      payload: { email: `master-${nanoid(4)}@example.com`, role: 'viewer' },
    });
    expect(postRes.statusCode).toBe(201);
  });

  // ─── project-scoped API key acts as owner ────────────────────
  // Skipped: the test server does not wire apiKeyService into the auth
  // middleware (registerAuthMiddleware is called without the apiKeyService
  // argument). Testing this flow requires inserting a hashed API key into
  // the DB and passing apiKeyService to registerAuthMiddleware — a
  // test-server refactor outside the scope of this PR.

  it.skip('project-scoped API key acts as owner for its project', () => {
    // TODO: refactor createTestServer to accept apiKeyService in the auth
    // middleware call. Then: insert an api_key row with projectId=x, hash
    // the plaintext, send as Bearer token, verify RBAC treats it as owner.
  });

  // ─── cannot delete last owner ─────────────────────────────────

  it('cannot delete the last owner of a project (409)', async () => {
    // Remove operator and viewer so only owner remains
    await testDb.prisma.projectMember.deleteMany({
      where: { projectId, role: { in: ['operator', 'viewer'] } },
    });

    const members = await testDb.prisma.projectMember.findMany({ where: { projectId } });
    expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);
    const ownerId = members.find((m) => m.email === ownerEmail)!.id;

    const res = await openServer.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/members/${ownerId}`,
      headers: { 'x-user-email': ownerEmail },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('LAST_OWNER_CANNOT_BE_REMOVED');
  });

  // ─── POST member is idempotent ────────────────────────────────

  it('POST member is idempotent on (projectId, email) conflict — updates role, returns 200', async () => {
    // First call → 201 (create)
    const firstRes = await openServer.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { 'x-user-email': ownerEmail },
      payload: { email: 'idempotent@example.com', role: 'viewer' },
    });
    expect(firstRes.statusCode).toBe(201);
    const firstId = (JSON.parse(firstRes.body) as { data: { member: { id: string } } }).data.member.id;

    // Second call with same email but different role → 200 (update)
    const secondRes = await openServer.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { 'x-user-email': ownerEmail },
      payload: { email: 'idempotent@example.com', role: 'operator' },
    });
    expect(secondRes.statusCode).toBe(200);
    const updated = JSON.parse(secondRes.body) as {
      data: { member: { id: string; role: string } };
    };
    // Same record, role updated
    expect(updated.data.member.id).toBe(firstId);
    expect(updated.data.member.role).toBe('operator');
  });

  // ─── No auth → 401 ───────────────────────────────────────────

  it('requests without auth header and without x-user-email return 401', async () => {
    const res = await openServer.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/members`,
      // no headers at all
    });
    expect(res.statusCode).toBe(401);
  });

  // ─── Non-member email → 403 ──────────────────────────────────

  it('x-user-email not in project members returns 403', async () => {
    const res = await openServer.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { 'x-user-email': 'stranger@nowhere.com' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // ─── Agent RBAC gap (reported) ────────────────────────────────
  // MISSING FEATURE: Agent creation routes (POST /projects/:id/agents) do NOT
  // have requireProjectRole. Any authenticated caller can create agents.
  // Tests below are skipped until RBAC is added to agent routes.

  it.skip('viewer cannot create agent (403) — BUG: no RBAC on POST /agents', () => {
    // When agent routes add requireProjectRole('operator'), un-skip this.
  });

  it.skip('operator can create agent — BUG: no RBAC on POST /agents', () => {
    // When agent routes add requireProjectRole('operator'), un-skip this.
  });
});
