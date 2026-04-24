import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ProjectRole } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';
import { registerAuthMiddleware, requireProjectRole } from './auth-middleware.js';
import type { MemberRepository, ProjectMember } from '@/infrastructure/repositories/member-repository.js';

// ─── Helpers ────────────────────────────────────────────────────

const TEST_KEY = 'test-secret-key-1234567890abcdef';

async function buildServer(apiKey: string): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  const logger = createLogger();

  await server.register(
    async (prefixed) => {
      registerAuthMiddleware(prefixed, apiKey, logger);

      // A protected endpoint
      prefixed.get('/projects', async () => ({ ok: true }));

      // A webhook endpoint (exempt)
      prefixed.post('/webhooks/chatwoot', async () => ({ received: true }));
      prefixed.post('/webhooks/telegram-approval', async () => ({ received: true }));
    },
    { prefix: '/api/v1' },
  );

  await server.ready();
  return server;
}

// ─── Suite: auth enabled ────────────────────────────────────────

describe('registerAuthMiddleware — auth enabled', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer(TEST_KEY);
  });

  afterAll(async () => {
    await server.close();
  });

  it('allows requests with valid Bearer token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${TEST_KEY}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests with no Authorization header (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Missing') });
  });

  it('rejects requests with wrong token (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Invalid API key' });
  });

  it('rejects requests with malformed Authorization header (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: 'Basic abc123' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Invalid Authorization format') });
  });

  it('rejects requests with empty Bearer value (401)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: 'Bearer ' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows webhook routes WITHOUT Authorization header', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks/chatwoot',
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows telegram-approval webhook WITHOUT Authorization header', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks/telegram-approval',
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows query strings on webhook routes', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks/chatwoot?hub.verify_token=abc',
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─── Suite: auth disabled (no NEXUS_API_KEY) ────────────────────

describe('registerAuthMiddleware — auth disabled (empty key)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer(''); // Empty key = open mode
  });

  afterAll(async () => {
    await server.close();
  });

  it('allows all requests without any Authorization header', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/projects',
    });
    expect(res.statusCode).toBe(200);
  });

  it('still serves webhook routes normally', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks/chatwoot',
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─── Suite: requireProjectRole (A3 RBAC) ────────────────────────

const PROJECT_ID = 'proj-test-123';
const TEST_API_KEY = 'test-secret-key-1234567890abcdef';

function makeMember(role: ProjectRole, email = 'user@example.com'): ProjectMember {
  return {
    id: 'mem-1',
    projectId: PROJECT_ID,
    userId: email,
    email,
    role,
    invitedBy: null,
    acceptedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMockRepo(member: ProjectMember | null = null): MemberRepository {
  return {
    findByProjectId: vi.fn().mockResolvedValue(member ? [member] : []),
    findByEmail: vi.fn().mockResolvedValue(member),
    upsert: vi.fn().mockResolvedValue(member),
    updateRole: vi.fn().mockResolvedValue(member),
    delete: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Build a test server for requireProjectRole tests.
 *
 * IMPORTANT: We use an EMPTY apiKey so auth is disabled and
 * `request.apiKeyProjectId` stays `undefined`. This lets the x-user-email
 * path run without being short-circuited by the master-key bypass.
 * Tests that exercise the bypass rules inject apiKeyProjectId directly
 * via a custom onRequest hook (see "bypass + lookup" suite).
 */
async function buildRbacServer(
  memberRepo: MemberRepository,
  minRole: ProjectRole,
): Promise<FastifyInstance> {
  const logger = createLogger();
  const server = Fastify({ logger: false });

  await server.register(
    async (prefixed) => {
      registerAuthMiddleware(prefixed, '', logger); // auth disabled → apiKeyProjectId stays undefined

      prefixed.get(
        '/projects/:projectId/resource',
        { preHandler: requireProjectRole(minRole, { memberRepository: memberRepo, logger }) },
        async (req) => ({ ok: true, projectRole: req.projectRole }),
      );
      prefixed.post(
        '/projects/:projectId/resource',
        { preHandler: requireProjectRole(minRole, { memberRepository: memberRepo, logger }) },
        async () => ({ ok: true }),
      );
    },
    { prefix: '/api/v1' },
  );

  await server.ready();
  return server;
}

// ─── Precedence tests ──────────────────────────────────────────
// Auth is disabled (empty key) so apiKeyProjectId stays undefined.
// Only x-user-email drives the member lookup.

describe('requireProjectRole — precedence', () => {
  const cases: Array<[ProjectRole, ProjectRole, boolean]> = [
    ['viewer',   'viewer',   true],
    ['operator', 'viewer',   true],
    ['owner',    'viewer',   true],
    ['viewer',   'operator', false],
    ['operator', 'operator', true],
    ['owner',    'operator', true],
    ['viewer',   'owner',    false],
    ['operator', 'owner',    false],
    ['owner',    'owner',    true],
  ];

  for (const [actual, required, shouldPass] of cases) {
    it(`${actual} vs min=${required} → ${shouldPass ? 'allow' : '403'}`, async () => {
      const repo = makeMockRepo(makeMember(actual));
      const server = await buildRbacServer(repo, required);

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${PROJECT_ID}/resource`,
        headers: { 'x-user-email': 'user@example.com' },
      });

      expect(res.statusCode).toBe(shouldPass ? 200 : 403);
      await server.close();
    });
  }
});

// ─── Bypass + lookup tests ─────────────────────────────────────

describe('requireProjectRole — bypass + lookup', () => {
  it('master key (apiKeyProjectId=null) bypasses role check — no member lookup', async () => {
    const repo = makeMockRepo(null);
    const logger = createLogger();
    const s = Fastify({ logger: false });

    await s.register(
      async (prefixed) => {
        prefixed.addHook('onRequest', async (req) => { req.apiKeyProjectId = null; });
        prefixed.get(
          '/projects/:projectId/resource',
          { preHandler: requireProjectRole('owner', { memberRepository: repo, logger }) },
          async () => ({ ok: true }),
        );
      },
      { prefix: '/api/v1' },
    );
    await s.ready();

    const res = await s.inject({ method: 'GET', url: `/api/v1/projects/${PROJECT_ID}/resource` });
    expect(res.statusCode).toBe(200);
    expect(repo.findByEmail).not.toHaveBeenCalled();
    await s.close();
  });

  it('missing x-user-email with apiKeyProjectId=undefined → 401', async () => {
    // auth disabled, no x-user-email → falls through to 401
    const repo = makeMockRepo(null);
    const server = await buildRbacServer(repo, 'viewer');

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/resource`,
      // No x-user-email
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.error.code).toBe('UNAUTHORIZED');
    await server.close();
  });

  it('unknown email → 403 (not a member)', async () => {
    const repo = makeMockRepo(null); // findByEmail returns null for anyone
    const server = await buildRbacServer(repo, 'viewer');

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/resource`,
      headers: { 'x-user-email': 'stranger@example.com' },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ success: boolean; error: { code: string } }>();
    expect(body.error.code).toBe('FORBIDDEN');
    await server.close();
  });

  it('email is looked up with the value passed in the header', async () => {
    const email = 'user@example.com';
    const repo = makeMockRepo(makeMember('viewer', email));
    const server = await buildRbacServer(repo, 'viewer');

    await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/resource`,
      headers: { 'x-user-email': email },
    });

    expect(repo.findByEmail).toHaveBeenCalledWith(PROJECT_ID, email);
    await server.close();
  });

  it('member with acceptedAt=null still passes (pending invite is active)', async () => {
    const member = { ...makeMember('viewer'), acceptedAt: null };
    const repo = makeMockRepo(member);
    const server = await buildRbacServer(repo, 'viewer');

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/resource`,
      headers: { 'x-user-email': 'user@example.com' },
    });

    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('attaches request.projectRole on successful lookup', async () => {
    const repo = makeMockRepo(makeMember('operator'));
    const server = await buildRbacServer(repo, 'viewer');

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/projects/${PROJECT_ID}/resource`,
      headers: { 'x-user-email': 'user@example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ projectRole: string }>().projectRole).toBe('operator');
    await server.close();
  });

  it('route with no :projectId param passes through without lookup', async () => {
    const repo = makeMockRepo(null);
    const logger = createLogger();
    const s = Fastify({ logger: false });

    await s.register(
      async (prefixed) => {
        prefixed.get(
          '/no-project-scope',
          { preHandler: requireProjectRole('owner', { memberRepository: repo, logger }) },
          async () => ({ ok: true }),
        );
      },
      { prefix: '/api/v1' },
    );
    await s.ready();

    const res = await s.inject({ method: 'GET', url: '/api/v1/no-project-scope' });
    expect(res.statusCode).toBe(200);
    expect(repo.findByEmail).not.toHaveBeenCalled();
    await s.close();
  });

  it('project API key (same project) treated as owner — no member lookup', async () => {
    const repo = makeMockRepo(null);
    const logger = createLogger();
    const s = Fastify({ logger: false });

    await s.register(
      async (prefixed) => {
        prefixed.addHook('onRequest', async (req) => { req.apiKeyProjectId = PROJECT_ID; });
        prefixed.get(
          '/projects/:projectId/resource',
          { preHandler: requireProjectRole('owner', { memberRepository: repo, logger }) },
          async (req) => ({ ok: true, projectRole: req.projectRole }),
        );
      },
      { prefix: '/api/v1' },
    );
    await s.ready();

    const res = await s.inject({ method: 'GET', url: `/api/v1/projects/${PROJECT_ID}/resource` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ projectRole: string }>().projectRole).toBe('owner');
    expect(repo.findByEmail).not.toHaveBeenCalled();
    await s.close();
  });
});

// ─── Matrix: role × op ────────────────────────────────────────
// Auth disabled, x-user-email drives lookup. GET=viewer min; POST=owner min.

describe('requireProjectRole — matrix (role × op)', () => {
  const opConfig: Array<{ opName: string; method: 'GET' | 'POST'; min: ProjectRole }> = [
    { opName: 'GET',  method: 'GET',  min: 'viewer' },
    { opName: 'POST', method: 'POST', min: 'owner'  },
  ];

  for (const { opName, method, min } of opConfig) {
    for (const role of ['viewer', 'operator', 'owner'] as const) {
      const roleRank: Record<ProjectRole, number> = { viewer: 1, operator: 2, owner: 3 };
      const shouldPass = roleRank[role] >= roleRank[min];

      it(`${role} × ${opName} (min=${min}) → ${shouldPass ? 'allow' : '403'}`, async () => {
        const repo = makeMockRepo(makeMember(role));
        const server = await buildRbacServer(repo, min);

        const res = await server.inject({
          method,
          url: `/api/v1/projects/${PROJECT_ID}/resource`,
          headers: { 'x-user-email': 'user@example.com' },
        });

        expect(res.statusCode).toBe(shouldPass ? 200 : 403);
        await server.close();
      });
    }
  }
});
