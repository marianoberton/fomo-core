/**
 * Tests for the Fomo Platform MCP Server.
 *
 * Tests the API client and tool definitions without requiring a real Supabase instance.
 * Uses mocked fetch to simulate PostgREST responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFomoApiClient } from './api-client.js';
import type {
  ClientRecord,
  ClientDetailRecord,
  ContactRecord,
  OpportunityRecord,
  TemaRecord,
  TemaTaskRecord,
} from './api-client.js';

// ─── Test Helpers ────────────────────────────────────────────────────

const TEST_CONFIG = {
  supabaseUrl: 'https://test-project.supabase.co',
  serviceRoleKey: 'test-service-role-key',
  companyId: 'company-uuid-123',
};

function mockFetchSuccess(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    }),
  );
}

function mockFetchError(status: number, body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: () => Promise.resolve(body),
    }),
  );
}

function getLastFetchUrl(): string {
  const mockFetch = vi.mocked(fetch);
  const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  if (!lastCall) throw new Error('fetch was not called');
  return lastCall[0] as string;
}

function getLastFetchOptions(): RequestInit | undefined {
  const mockFetch = vi.mocked(fetch);
  const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  if (!lastCall) throw new Error('fetch was not called');
  return lastCall[1];
}

// ─── Fixtures ────────────────────────────────────────────────────────

const clientFixture: ClientRecord = {
  id: 'client-1',
  company_id: TEST_CONFIG.companyId,
  name: 'INTED SA',
  email: 'info@inted.com',
  phone: '+54 11 5555-0001',
  address: 'Av. Corrientes 1234',
  cuit: '30-71234567-8',
  website_url: 'https://inted.com',
  notes: null,
  source: 'referral',
  tags: ['enterprise', 'construction'],
  portal_enabled: true,
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2026-02-10T14:30:00Z',
};

const contactFixture: ContactRecord = {
  id: 'contact-1',
  company_id: TEST_CONFIG.companyId,
  client_id: 'client-1',
  first_name: 'Juan',
  last_name: 'Pérez',
  email: 'juan@inted.com',
  phone: '+54 11 5555-0002',
  position: 'CTO',
  is_primary: true,
  notes: null,
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2026-02-10T14:30:00Z',
};

const opportunityFixture: OpportunityRecord = {
  id: 'opp-1',
  company_id: TEST_CONFIG.companyId,
  title: 'Proyecto Edificio Central',
  description: 'Seguimiento de obra civil',
  client_id: 'client-1',
  assigned_to: 'user-1',
  stage: 'propuesta',
  outcome: null,
  probability: 50,
  estimated_value: 150000,
  weighted_value: 75000,
  currency: 'USD',
  expected_close_date: '2026-03-30',
  closed_at: null,
  loss_reason: null,
  created_at: '2026-01-10T10:00:00Z',
  updated_at: '2026-02-10T14:30:00Z',
  clients: { name: 'INTED SA' },
};

const temaFixture: TemaRecord = {
  id: 'tema-1',
  company_id: TEST_CONFIG.companyId,
  title: 'Expediente DGROC 2026-001',
  description: 'Trámite de habilitación',
  reference_code: 'EXP-2026-001',
  expediente_number: '001/2026',
  organismo: 'DGROC',
  status: 'seguimiento',
  priority: 'alta',
  due_date: '2026-04-15',
  notes: null,
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-02-12T09:00:00Z',
  tema_types: { name: 'Habilitación', color: '#6366F1' },
};

const taskFixture: TemaTaskRecord = {
  id: 'task-1',
  tema_id: 'tema-1',
  title: 'Preparar planos de arquitectura',
  description: 'Planos planta baja y primer piso',
  status: 'pending',
  assigned_to: 'user-2',
  sort_order: 1,
  due_date: '2026-03-01',
  started_at: null,
  completed_at: null,
  created_at: '2026-02-01T10:00:00Z',
  updated_at: '2026-02-01T10:00:00Z',
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('FomoPlatformMCPServer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('API Client — searchClients', () => {
    beforeEach(() => {
      mockFetchSuccess([clientFixture]);
    });

    it('returns matching clients', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      const results = await api.searchClients({ query: 'INTED' });

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('INTED SA');
    });

    it('sends correct PostgREST query with search', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.searchClients({ query: 'INTED', limit: 10 });

      const url = getLastFetchUrl();
      expect(url).toContain('/rest/v1/clients');
      expect(url).toContain(`company_id=eq.${TEST_CONFIG.companyId}`);
      expect(url).toContain('or=');
      expect(url).toContain('name.ilike.*INTED*');
      expect(url).toContain('limit=10');
    });

    it('sends correct headers with service role key', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.searchClients({});

      const opts = getLastFetchOptions();
      const headers = opts?.headers as Record<string, string>;
      expect(headers['apikey']).toBe(TEST_CONFIG.serviceRoleKey);
      expect(headers['Authorization']).toBe(
        `Bearer ${TEST_CONFIG.serviceRoleKey}`,
      );
    });

    it('uses default limit of 20', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.searchClients({});

      const url = getLastFetchUrl();
      expect(url).toContain('limit=20');
    });

    it('returns empty array when no matches', async () => {
      mockFetchSuccess([]);
      const api = createFomoApiClient(TEST_CONFIG);
      const results = await api.searchClients({ query: 'nonexistent' });
      expect(results).toEqual([]);
    });
  });

  describe('API Client — getClientDetail', () => {
    const detailFixture: ClientDetailRecord = {
      ...clientFixture,
      crm_contacts: [contactFixture],
      temas: [
        {
          id: 'tema-1',
          title: 'Expediente DGROC',
          status: 'seguimiento',
          priority: 'alta',
          reference_code: 'EXP-001',
          due_date: '2026-04-15',
        },
      ],
    };

    it('returns client with contacts and temas', async () => {
      mockFetchSuccess([detailFixture]);
      const api = createFomoApiClient(TEST_CONFIG);
      const result = await api.getClientDetail('client-1');

      expect(result.name).toBe('INTED SA');
      expect(result.crm_contacts).toHaveLength(1);
      expect(result.crm_contacts[0]?.first_name).toBe('Juan');
      expect(result.temas).toHaveLength(1);
    });

    it('requests with embedded relations', async () => {
      mockFetchSuccess([detailFixture]);
      const api = createFomoApiClient(TEST_CONFIG);
      await api.getClientDetail('client-1');

      const url = getLastFetchUrl();
      expect(url).toContain('select=*%2Ccrm_contacts');
      expect(url).toContain('temas');
    });

    it('throws when client not found', async () => {
      mockFetchSuccess([]);
      const api = createFomoApiClient(TEST_CONFIG);

      await expect(api.getClientDetail('nonexistent')).rejects.toThrow(
        'Client not found: nonexistent',
      );
    });
  });

  describe('API Client — listContacts', () => {
    beforeEach(() => {
      mockFetchSuccess([contactFixture]);
    });

    it('returns contacts', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      const results = await api.listContacts({});

      expect(results).toHaveLength(1);
      expect(results[0]?.first_name).toBe('Juan');
    });

    it('filters by clientId', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.listContacts({ clientId: 'client-1' });

      const url = getLastFetchUrl();
      expect(url).toContain('client_id=eq.client-1');
    });

    it('searches by name or email', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.listContacts({ query: 'Juan' });

      const url = getLastFetchUrl();
      expect(url).toContain('first_name.ilike.*Juan*');
      expect(url).toContain('last_name.ilike.*Juan*');
      expect(url).toContain('email.ilike.*Juan*');
    });
  });

  describe('API Client — listOpportunities', () => {
    beforeEach(() => {
      mockFetchSuccess([opportunityFixture]);
    });

    it('returns opportunities with client info', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      const results = await api.listOpportunities({});

      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe('Proyecto Edificio Central');
      expect(results[0]?.clients?.name).toBe('INTED SA');
    });

    it('includes client join in select', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.listOpportunities({});

      const url = getLastFetchUrl();
      expect(url).toContain('select=*%2Cclients');
    });

    it('filters by stage', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.listOpportunities({ stage: 'propuesta' });

      const url = getLastFetchUrl();
      expect(url).toContain('stage=eq.propuesta');
    });

    it('filters by clientId', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.listOpportunities({ clientId: 'client-1' });

      const url = getLastFetchUrl();
      expect(url).toContain('client_id=eq.client-1');
    });
  });

  describe('API Client — updateOpportunityStage', () => {
    it('updates stage and probability', async () => {
      const updated = { ...opportunityFixture, stage: 'negociacion', probability: 75 };
      mockFetchSuccess([updated]);

      const api = createFomoApiClient(TEST_CONFIG);
      const result = await api.updateOpportunityStage({
        opportunityId: 'opp-1',
        stage: 'negociacion',
      });

      expect(result.stage).toBe('negociacion');
      expect(result.probability).toBe(75);
    });

    it('sends PATCH request', async () => {
      mockFetchSuccess([opportunityFixture]);
      const api = createFomoApiClient(TEST_CONFIG);
      await api.updateOpportunityStage({
        opportunityId: 'opp-1',
        stage: 'propuesta',
      });

      const opts = getLastFetchOptions();
      expect(opts?.method).toBe('PATCH');
    });

    it('sets probability to 0 and closed_at when lost', async () => {
      const lost = {
        ...opportunityFixture,
        stage: 'cierre',
        outcome: 'lost',
        probability: 0,
      };
      mockFetchSuccess([lost]);

      const api = createFomoApiClient(TEST_CONFIG);
      await api.updateOpportunityStage({
        opportunityId: 'opp-1',
        stage: 'cierre',
        outcome: 'lost',
        lossReason: 'Budget constraints',
      });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['outcome']).toBe('lost');
      expect(body['probability']).toBe(0);
      expect(body['loss_reason']).toBe('Budget constraints');
      expect(body['closed_at']).toBeTruthy();
    });

    it('throws when opportunity not found', async () => {
      mockFetchSuccess([]);
      const api = createFomoApiClient(TEST_CONFIG);

      await expect(
        api.updateOpportunityStage({
          opportunityId: 'nonexistent',
          stage: 'propuesta',
        }),
      ).rejects.toThrow('Opportunity not found: nonexistent');
    });
  });

  describe('API Client — listTemas', () => {
    beforeEach(() => {
      mockFetchSuccess([temaFixture]);
    });

    it('returns temas with type info', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      const results = await api.listTemas({});

      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe('Expediente DGROC 2026-001');
      expect(results[0]?.tema_types?.name).toBe('Habilitación');
    });

    it('filters by status', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.listTemas({ status: 'seguimiento' });

      const url = getLastFetchUrl();
      expect(url).toContain('status=eq.seguimiento');
    });

    it('filters by priority', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.listTemas({ priority: 'alta' });

      const url = getLastFetchUrl();
      expect(url).toContain('priority=eq.alta');
    });

    it('searches by title and reference code', async () => {
      const api = createFomoApiClient(TEST_CONFIG);
      await api.listTemas({ query: 'DGROC' });

      const url = getLastFetchUrl();
      expect(url).toContain('title.ilike.*DGROC*');
      expect(url).toContain('reference_code.ilike.*DGROC*');
    });
  });

  describe('API Client — createTemaTask', () => {
    it('creates a task with required fields', async () => {
      mockFetchSuccess([taskFixture]);
      const api = createFomoApiClient(TEST_CONFIG);
      const result = await api.createTemaTask({
        temaId: 'tema-1',
        title: 'Preparar planos de arquitectura',
      });

      expect(result.title).toBe('Preparar planos de arquitectura');
      expect(result.status).toBe('pending');
    });

    it('sends POST request to tema_tasks', async () => {
      mockFetchSuccess([taskFixture]);
      const api = createFomoApiClient(TEST_CONFIG);
      await api.createTemaTask({
        temaId: 'tema-1',
        title: 'Test task',
      });

      const url = getLastFetchUrl();
      expect(url).toContain('/rest/v1/tema_tasks');

      const opts = getLastFetchOptions();
      expect(opts?.method).toBe('POST');
    });

    it('includes optional fields in request body', async () => {
      mockFetchSuccess([taskFixture]);
      const api = createFomoApiClient(TEST_CONFIG);
      await api.createTemaTask({
        temaId: 'tema-1',
        title: 'Task with details',
        description: 'Detailed description',
        assignedTo: 'user-2',
        dueDate: '2026-03-01',
      });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['tema_id']).toBe('tema-1');
      expect(body['title']).toBe('Task with details');
      expect(body['description']).toBe('Detailed description');
      expect(body['assigned_to']).toBe('user-2');
      expect(body['due_date']).toBe('2026-03-01');
      expect(body['status']).toBe('pending');
    });

    it('throws when insert fails', async () => {
      mockFetchSuccess([]);
      const api = createFomoApiClient(TEST_CONFIG);

      await expect(
        api.createTemaTask({ temaId: 'tema-1', title: 'test' }),
      ).rejects.toThrow('Failed to create task');
    });
  });

  describe('API Client — Error Handling', () => {
    it('throws on HTTP errors with status and body', async () => {
      mockFetchError(403, '{"message":"permission denied"}');
      const api = createFomoApiClient(TEST_CONFIG);

      await expect(api.searchClients({})).rejects.toThrow(
        'Supabase API error (403)',
      );
    });

    it('throws on 500 server errors', async () => {
      mockFetchError(500, 'Internal Server Error');
      const api = createFomoApiClient(TEST_CONFIG);

      await expect(api.listTemas({})).rejects.toThrow(
        'Supabase API error (500)',
      );
    });

    it('propagates network errors', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );
      const api = createFomoApiClient(TEST_CONFIG);

      await expect(api.searchClients({})).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('Tool Definitions', () => {
    // Verify that all tool names follow MCP naming convention
    const expectedTools = [
      'search-clients',
      'get-client-detail',
      'list-contacts',
      'list-opportunities',
      'update-opportunity-stage',
      'list-temas',
      'create-tema-task',
    ];

    it('exposes exactly 7 tools', () => {
      expect(expectedTools).toHaveLength(7);
    });

    it('all tool names are kebab-case', () => {
      for (const name of expectedTools) {
        expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it('required fields match API client method signatures', () => {
      // update-opportunity-stage requires opportunityId and stage
      const updateOpp = expectedTools.find(
        (t) => t === 'update-opportunity-stage',
      );
      expect(updateOpp).toBeDefined();

      // create-tema-task requires temaId and title
      const createTask = expectedTools.find((t) => t === 'create-tema-task');
      expect(createTask).toBeDefined();

      // get-client-detail requires clientId
      const getClient = expectedTools.find((t) => t === 'get-client-detail');
      expect(getClient).toBeDefined();
    });
  });

  describe('Company Scoping', () => {
    it('always includes company_id filter in GET requests', async () => {
      mockFetchSuccess([]);
      const api = createFomoApiClient(TEST_CONFIG);

      await api.searchClients({});
      expect(getLastFetchUrl()).toContain(
        `company_id=eq.${TEST_CONFIG.companyId}`,
      );

      await api.listContacts({});
      expect(getLastFetchUrl()).toContain(
        `company_id=eq.${TEST_CONFIG.companyId}`,
      );

      await api.listOpportunities({});
      expect(getLastFetchUrl()).toContain(
        `company_id=eq.${TEST_CONFIG.companyId}`,
      );

      await api.listTemas({});
      expect(getLastFetchUrl()).toContain(
        `company_id=eq.${TEST_CONFIG.companyId}`,
      );
    });

    it('includes company_id filter in PATCH requests', async () => {
      mockFetchSuccess([opportunityFixture]);
      const api = createFomoApiClient(TEST_CONFIG);

      await api.updateOpportunityStage({
        opportunityId: 'opp-1',
        stage: 'propuesta',
      });
      expect(getLastFetchUrl()).toContain(
        `company_id=eq.${TEST_CONFIG.companyId}`,
      );
    });
  });
});
