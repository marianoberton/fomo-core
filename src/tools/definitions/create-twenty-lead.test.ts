/**
 * Tests for create-twenty-lead tool.
 *
 * 3 levels: Schema validation, Dry Run, Integration (mocked fetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTwentyCrmTool } from './create-twenty-lead.js';
import type { SecretService } from '@/secrets/types.js';
import { createTestContext } from '@/testing/fixtures/context.js';

// ─── Helpers ────────────────────────────────────────────────────

function createMockSecretService(overrides?: Partial<SecretService>): SecretService {
  return {
    set: vi.fn(),
    get: vi.fn((_projectId: string, key: string) => {
      if (key === 'TWENTY_API_KEY') return Promise.resolve('test-twenty-api-key');
      return Promise.reject(new Error(`Secret not found: ${key}`));
    }),
    list: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve(false)),
    exists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

function validInput() {
  return {
    firstName: 'Juan',
    lastName: 'Pérez',
    email: 'juan@example.com',
    phone: '+5491155551234',
    company: 'Acme SA',
    source: 'whatsapp' as const,
    notes: 'Interesado en plan enterprise',
  };
}

function makeTool(secretOverrides?: Partial<SecretService>) {
  return createTwentyCrmTool({
    twentyBaseUrl: 'https://crm.test.com',
    secretService: createMockSecretService(secretOverrides),
  });
}

// ─── Schema Validation ──────────────────────────────────────────

describe('create-twenty-lead / schema', () => {
  const tool = makeTool();

  it('accepts valid input with all fields', () => {
    const result = tool.inputSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it('accepts minimal input (firstName + company only)', () => {
    const result = tool.inputSchema.safeParse({
      firstName: 'Ana',
      company: 'Startup SRL',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastName).toBe('');
      expect(result.data.source).toBe('web');
    }
  });

  it('rejects missing firstName', () => {
    const result = tool.inputSchema.safeParse({
      company: 'Acme',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing company', () => {
    const result = tool.inputSchema.safeParse({
      firstName: 'Juan',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = tool.inputSchema.safeParse({
      ...validInput(),
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid source', () => {
    const result = tool.inputSchema.safeParse({
      ...validInput(),
      source: 'invalid_channel',
    });
    expect(result.success).toBe(false);
  });

  it('rejects notes exceeding 2000 chars', () => {
    const result = tool.inputSchema.safeParse({
      ...validInput(),
      notes: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Dry Run ────────────────────────────────────────────────────

describe('create-twenty-lead / dryRun', () => {
  const tool = makeTool();

  it('returns expected shape without side effects', async () => {
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });
    const result = await tool.dryRun(validInput(), ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.success).toBe(true);
    expect(result.value.output).toEqual({
      dryRun: true,
      wouldCreate: {
        company: 'Acme SA',
        contact: 'Juan Pérez',
        email: 'juan@example.com',
        phone: '+5491155551234',
        opportunity: 'Acme SA - Lead',
        source: 'whatsapp',
      },
    });
    expect(result.value.durationMs).toBe(0);
  });

  it('returns error for invalid input', async () => {
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });
    const result = await tool.dryRun({ bad: true }, ctx);
    expect(result.ok).toBe(false);
  });

  it('uses custom opportunityName when provided', async () => {
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });
    const input = { ...validInput(), opportunityName: 'Custom Deal' };
    const result = await tool.dryRun(input, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value.output as Record<string, unknown>;
    const wouldCreate = output['wouldCreate'] as Record<string, unknown>;
    expect(wouldCreate['opportunity']).toBe('Custom Deal');
  });
});

// ─── Execution (mocked fetch) ───────────────────────────────────

describe('create-twenty-lead / execute', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchSequence(responses: { ok: boolean; status: number; data: unknown }[]) {
    for (const resp of responses) {
      fetchMock.mockResolvedValueOnce({
        ok: resp.ok,
        status: resp.status,
        json: () => Promise.resolve(resp.data),
      });
    }
  }

  it('creates company, person, and opportunity when none exist', async () => {
    const tool = makeTool();
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });

    mockFetchSequence([
      // findCompany → not found
      { ok: true, status: 200, data: { data: { companies: { edges: [] } } } },
      // createCompany
      { ok: true, status: 201, data: { data: { createCompany: { id: 'comp-1' } } } },
      // findPerson → not found
      { ok: true, status: 200, data: { data: { people: { edges: [] } } } },
      // createPerson
      { ok: true, status: 201, data: { data: { createPerson: { id: 'person-1' } } } },
      // createOpportunity
      { ok: true, status: 201, data: { data: { createOpportunity: { id: 'opp-1' } } } },
    ]);

    const result = await tool.execute(validInput(), ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const output = result.value.output as Record<string, unknown>;
    expect(output['companyId']).toBe('comp-1');
    expect(output['personId']).toBe('person-1');
    expect(output['opportunityId']).toBe('opp-1');
    expect(output['companyCreated']).toBe(true);
    expect(output['personCreated']).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('reuses existing company and person', async () => {
    const tool = makeTool();
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });

    mockFetchSequence([
      // findCompany → found
      {
        ok: true,
        status: 200,
        data: { data: { companies: { edges: [{ node: { id: 'existing-comp' } }] } } },
      },
      // findPerson → found
      {
        ok: true,
        status: 200,
        data: { data: { people: { edges: [{ node: { id: 'existing-person' } }] } } },
      },
      // createOpportunity
      { ok: true, status: 201, data: { data: { createOpportunity: { id: 'opp-2' } } } },
    ]);

    const result = await tool.execute(validInput(), ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const output = result.value.output as Record<string, unknown>;
    expect(output['companyId']).toBe('existing-comp');
    expect(output['personId']).toBe('existing-person');
    expect(output['companyCreated']).toBe(false);
    expect(output['personCreated']).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sends correct Authorization header', async () => {
    const tool = makeTool();
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });

    mockFetchSequence([
      { ok: true, status: 200, data: { data: { companies: { edges: [] } } } },
      { ok: true, status: 201, data: { data: { createCompany: { id: 'c1' } } } },
      { ok: true, status: 200, data: { data: { people: { edges: [] } } } },
      { ok: true, status: 201, data: { data: { createPerson: { id: 'p1' } } } },
      { ok: true, status: 201, data: { data: { createOpportunity: { id: 'o1' } } } },
    ]);

    await tool.execute(validInput(), ctx);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-twenty-api-key');
  });

  it('returns error when TWENTY_API_KEY is missing', async () => {
    const tool = makeTool({
      get: vi.fn(() => Promise.reject(new Error('Secret not found'))),
    });
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });

    const result = await tool.execute(validInput(), ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('TWENTY_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error when Twenty API fails on createCompany', async () => {
    const tool = makeTool();
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });

    mockFetchSequence([
      // findCompany → not found
      { ok: true, status: 200, data: { data: { companies: { edges: [] } } } },
      // createCompany → fails
      { ok: false, status: 500, data: { error: 'Internal Server Error' } },
    ]);

    const result = await tool.execute(validInput(), ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Twenty CRM error');
  });

  it('returns error for invalid input', async () => {
    const tool = makeTool();
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });

    const result = await tool.execute({ bad: true }, ctx);
    expect(result.ok).toBe(false);
  });

  it('strips trailing slash from base URL', async () => {
    const tool = createTwentyCrmTool({
      twentyBaseUrl: 'https://crm.test.com/',
      secretService: createMockSecretService(),
    });
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });

    mockFetchSequence([
      { ok: true, status: 200, data: { data: { companies: { edges: [] } } } },
      { ok: true, status: 201, data: { data: { createCompany: { id: 'c1' } } } },
      { ok: true, status: 200, data: { data: { people: { edges: [] } } } },
      { ok: true, status: 201, data: { data: { createPerson: { id: 'p1' } } } },
      { ok: true, status: 201, data: { data: { createOpportunity: { id: 'o1' } } } },
    ]);

    await tool.execute(validInput(), ctx);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/crm\.test\.com\/rest\//);
    expect(url).not.toContain('//rest');
  });

  it('includes CRM URL in output', async () => {
    const tool = makeTool();
    const ctx = createTestContext({ allowedTools: ['create-twenty-lead'] });

    mockFetchSequence([
      { ok: true, status: 200, data: { data: { companies: { edges: [] } } } },
      { ok: true, status: 201, data: { data: { createCompany: { id: 'c1' } } } },
      { ok: true, status: 200, data: { data: { people: { edges: [] } } } },
      { ok: true, status: 201, data: { data: { createPerson: { id: 'p1' } } } },
      { ok: true, status: 201, data: { data: { createOpportunity: { id: 'opp-99' } } } },
    ]);

    const result = await tool.execute(validInput(), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const output = result.value.output as Record<string, unknown>;
    expect(output['crmUrl']).toBe('https://crm.test.com/crm/opportunities/opp-99');
  });
});
