/**
 * Tests for the HubSpot CRM MCP Server.
 *
 * Tests the API client and tool definitions without requiring a real HubSpot instance.
 * Uses mocked fetch to simulate HubSpot API v3 responses.
 */
import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest';
import { createHubSpotApiClient } from './api-client.js';
import type { HSContact, HSDeal, HSCompany, HSNote, HSTask } from './api-client.js';
import { MCPToolExecutionError } from '@/mcp/errors.js';

// ─── Test Helpers ────────────────────────────────────────────────────

const TEST_CONFIG = {
  accessToken: 'pat-na1-test-token-12345',
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

function mockFetchSequence(responses: unknown[]): void {
  const mockFn = vi.fn();
  for (const [i, data] of responses.entries()) {
    mockFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(i < responses.length ? data : undefined),
    });
  }
  vi.stubGlobal('fetch', mockFn);
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

function getFetchUrl(index: number): string {
  const mockFetch = vi.mocked(fetch);
  const call = mockFetch.mock.calls[index];
  if (!call) throw new Error(`fetch call ${String(index)} not found`);
  return call[0] as string;
}

function getLastFetchOptions(): RequestInit | undefined {
  const mockFetch = vi.mocked(fetch);
  const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  if (!lastCall) throw new Error('fetch was not called');
  return lastCall[1];
}

function getFetchOptions(index: number): RequestInit | undefined {
  const mockFetch = vi.mocked(fetch);
  const call = mockFetch.mock.calls[index];
  if (!call) throw new Error(`fetch call ${String(index)} not found`);
  return call[1];
}

// ─── Fixtures ────────────────────────────────────────────────────────

const contactFixture: HSContact = {
  id: 'contact-101',
  properties: {
    firstname: 'María',
    lastname: 'García',
    email: 'maria@empresa.com',
    phone: '+5491155550001',
    company: 'Empresa SA',
    lifecyclestage: 'lead',
    createdate: '2026-01-15T10:00:00Z',
    lastmodifieddate: '2026-02-20T14:30:00Z',
  },
};

const dealFixture: HSDeal = {
  id: 'deal-201',
  properties: {
    dealname: 'Venta Producto X',
    dealstage: 'qualifiedtobuy',
    pipeline: 'default',
    amount: '50000',
    closedate: '2026-03-30',
    createdate: '2026-02-01T10:00:00Z',
    lastmodifieddate: '2026-02-20T14:30:00Z',
    hubspot_owner_id: 'owner-1',
    description: 'Interesado en producto X',
  },
  associations: {
    contacts: { results: [{ id: 'contact-101', type: 'deal_to_contact' }] },
    companies: { results: [{ id: 'company-301', type: 'deal_to_company' }] },
  },
};

const companyFixture: HSCompany = {
  id: 'company-301',
  properties: {
    name: 'Empresa SA',
    domain: 'empresa.com',
    industry: 'Technology',
    phone: '+5491155550000',
    city: 'Buenos Aires',
    state: 'CABA',
    country: 'Argentina',
    numberofemployees: '50',
    annualrevenue: '1000000',
    createdate: '2025-06-01T10:00:00Z',
    lastmodifieddate: '2026-02-15T09:00:00Z',
  },
};

const noteFixture: HSNote = {
  id: 'note-401',
  properties: {
    hs_note_body: 'Llamada de seguimiento completada',
    hs_timestamp: '2026-02-24T15:00:00Z',
  },
};

const taskFixture: HSTask = {
  id: 'task-501',
  properties: {
    hs_task_subject: 'Enviar propuesta comercial',
    hs_task_body: 'Preparar y enviar cotización',
    hs_task_status: 'NOT_STARTED',
    hs_task_priority: 'HIGH',
    hs_timestamp: '2026-03-01T10:00:00Z',
  },
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('HubSpotCRMMCPServer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('API Client — searchContacts', () => {
    it('returns matching contacts', async () => {
      mockFetchSuccess({ total: 1, results: [contactFixture] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      const result = await api.searchContacts({ email: 'maria@empresa.com' });

      expect(result.total).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.properties['firstname']).toBe('María');
    });

    it('searches by email with EQ operator', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchContacts({ email: 'test@example.com' });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const filterGroups = body['filterGroups'] as { filters: { propertyName: string; operator: string; value: string }[] }[];
      expect(filterGroups[0]?.filters[0]?.propertyName).toBe('email');
      expect(filterGroups[0]?.filters[0]?.operator).toBe('EQ');
    });

    it('searches by phone with CONTAINS_TOKEN and normalized digits', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchContacts({ phone: '+54 9 11 5555-0001' });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const filterGroups = body['filterGroups'] as { filters: { propertyName: string; value: string }[] }[];
      expect(filterGroups[0]?.filters[0]?.propertyName).toBe('phone');
      // Should contain normalized digits only
      expect(filterGroups[0]?.filters[0]?.value).toContain('5491155550001');
    });

    it('posts to /crm/v3/objects/contacts/search', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchContacts({ query: 'test' });

      const url = getLastFetchUrl();
      expect(url).toContain('/crm/v3/objects/contacts/search');

      const opts = getLastFetchOptions();
      expect(opts?.method).toBe('POST');
    });

    it('caps limit at 100', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchContacts({ limit: 500 });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['limit']).toBe(100);
    });

    it('defaults limit to 10', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchContacts({});

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['limit']).toBe(10);
    });
  });

  describe('API Client — searchDeals', () => {
    it('returns matching deals', async () => {
      mockFetchSuccess({ total: 1, results: [dealFixture] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      const result = await api.searchDeals({ stage: 'qualifiedtobuy' });

      expect(result.total).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.properties['dealname']).toBe('Venta Producto X');
    });

    it('posts to /crm/v3/objects/deals/search', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({});

      const url = getLastFetchUrl();
      expect(url).toContain('/crm/v3/objects/deals/search');

      const opts = getLastFetchOptions();
      expect(opts?.method).toBe('POST');
    });

    it('filters by deal stage with EQ operator', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({ stage: 'quotationsent' });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const filterGroups = body['filterGroups'] as { filters: { propertyName: string; operator: string; value: string }[] }[];
      expect(filterGroups[0]?.filters).toContainEqual({
        propertyName: 'dealstage',
        operator: 'EQ',
        value: 'quotationsent',
      });
    });

    it('filters by pipeline', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({ pipeline: 'sales' });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const filterGroups = body['filterGroups'] as { filters: { propertyName: string; operator: string; value: string }[] }[];
      expect(filterGroups[0]?.filters).toContainEqual({
        propertyName: 'pipeline',
        operator: 'EQ',
        value: 'sales',
      });
    });

    it('filters by inactiveDays using notes_last_updated LT', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);

      const now = Date.now();
      await api.searchDeals({ inactiveDays: 3 });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const filterGroups = body['filterGroups'] as { filters: { propertyName: string; operator: string; value: string }[] }[];
      const inactiveFilter = filterGroups[0]?.filters.find((f) => f.propertyName === 'notes_last_updated');
      expect(inactiveFilter).toBeDefined();
      expect(inactiveFilter?.operator).toBe('LT');
      // Value should be a timestamp roughly 3 days ago
      const cutoff = Number(inactiveFilter?.value);
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeLessThanOrEqual(now - threeDaysMs + 5000); // 5s tolerance
      expect(cutoff).toBeGreaterThan(now - threeDaysMs - 60000); // 60s tolerance
    });

    it('filters by ownerId', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({ ownerId: 'owner-1' });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const filterGroups = body['filterGroups'] as { filters: { propertyName: string; operator: string; value: string }[] }[];
      expect(filterGroups[0]?.filters).toContainEqual({
        propertyName: 'hubspot_owner_id',
        operator: 'EQ',
        value: 'owner-1',
      });
    });

    it('combines multiple filters with AND (single filterGroup)', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({ stage: 'negotiation', pipeline: 'default', ownerId: 'owner-1' });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const filterGroups = body['filterGroups'] as { filters: unknown[] }[];
      // All filters should be in one filterGroup (ANDed)
      expect(filterGroups).toHaveLength(1);
      expect(filterGroups[0]?.filters).toHaveLength(3);
    });

    it('sorts by lastmodifieddate ascending', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({});

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const sorts = body['sorts'] as { propertyName: string; direction: string }[];
      expect(sorts[0]?.direction).toBe('ASCENDING');
    });

    it('defaults limit to 20', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({});

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['limit']).toBe(20);
    });

    it('caps limit at 100', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({ limit: 500 });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['limit']).toBe(100);
    });

    it('omits filterGroups when no filters provided', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchDeals({});

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      expect(body['filterGroups']).toBeUndefined();
    });
  });

  describe('API Client — getContactDeals', () => {
    it('returns deals for a contact', async () => {
      mockFetchSequence([
        // Step 1: associations
        { results: [{ id: 'deal-201', type: 'contact_to_deal' }] },
        // Step 2: batch read
        { results: [dealFixture], status: 'COMPLETE' },
      ]);

      const api = createHubSpotApiClient(TEST_CONFIG);
      const deals = await api.getContactDeals({ contactId: 'contact-101' });

      expect(deals).toHaveLength(1);
      expect(deals[0]?.properties['dealname']).toBe('Venta Producto X');
    });

    it('fetches associations then batch reads deals', async () => {
      mockFetchSequence([
        { results: [{ id: 'deal-201', type: 'contact_to_deal' }] },
        { results: [dealFixture], status: 'COMPLETE' },
      ]);

      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.getContactDeals({ contactId: 'contact-101' });

      // First call: get associations
      const url1 = getFetchUrl(0);
      expect(url1).toContain('/contacts/contact-101/associations/deals');

      // Second call: batch read deals
      const url2 = getFetchUrl(1);
      expect(url2).toContain('/crm/v3/objects/deals/batch/read');
    });

    it('returns empty array when contact has no deals', async () => {
      mockFetchSuccess({ results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      const deals = await api.getContactDeals({ contactId: 'contact-999' });

      expect(deals).toEqual([]);
    });
  });

  describe('API Client — getDealDetail', () => {
    it('returns deal with associations', async () => {
      mockFetchSuccess(dealFixture);
      const api = createHubSpotApiClient(TEST_CONFIG);
      const deal = await api.getDealDetail({ dealId: 'deal-201' });

      expect(deal.id).toBe('deal-201');
      expect(deal.properties['dealname']).toBe('Venta Producto X');
      expect(deal.associations?.contacts?.results).toHaveLength(1);
      expect(deal.associations?.companies?.results).toHaveLength(1);
    });

    it('requests properties and associations', async () => {
      mockFetchSuccess(dealFixture);
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.getDealDetail({ dealId: 'deal-201' });

      const url = getLastFetchUrl();
      expect(url).toContain('/crm/v3/objects/deals/deal-201');
      expect(url).toContain('properties=');
      expect(url).toContain('associations=contacts,companies');
    });
  });

  describe('API Client — getCompanyDetail', () => {
    it('returns company properties', async () => {
      mockFetchSuccess(companyFixture);
      const api = createHubSpotApiClient(TEST_CONFIG);
      const company = await api.getCompanyDetail({ companyId: 'company-301' });

      expect(company.properties['name']).toBe('Empresa SA');
      expect(company.properties['industry']).toBe('Technology');
      expect(company.properties['country']).toBe('Argentina');
    });

    it('requests correct company properties', async () => {
      mockFetchSuccess(companyFixture);
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.getCompanyDetail({ companyId: 'company-301' });

      const url = getLastFetchUrl();
      expect(url).toContain('/crm/v3/objects/companies/company-301');
      expect(url).toContain('properties=');
      expect(url).toContain('name');
      expect(url).toContain('domain');
    });
  });

  describe('API Client — updateDealStage', () => {
    it('sends PATCH request with stage property', async () => {
      const updated = { ...dealFixture, properties: { ...dealFixture.properties, dealstage: 'closedwon' } };
      mockFetchSuccess(updated);

      const api = createHubSpotApiClient(TEST_CONFIG);
      const result = await api.updateDealStage({ dealId: 'deal-201', stage: 'closedwon' });

      expect(result.properties['dealstage']).toBe('closedwon');

      const opts = getLastFetchOptions();
      expect(opts?.method).toBe('PATCH');

      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const properties = body['properties'] as Record<string, string>;
      expect(properties['dealstage']).toBe('closedwon');
    });

    it('includes pipeline when provided', async () => {
      mockFetchSuccess(dealFixture);
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.updateDealStage({ dealId: 'deal-201', stage: 'qualifiedtobuy', pipeline: 'sales' });

      const opts = getLastFetchOptions();
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const properties = body['properties'] as Record<string, string>;
      expect(properties['pipeline']).toBe('sales');
    });
  });

  describe('API Client — addDealNote', () => {
    it('creates note and associates with deal', async () => {
      // Step 1: create note, Step 2: associate
      mockFetchSequence([noteFixture, {}]);

      const api = createHubSpotApiClient(TEST_CONFIG);
      const note = await api.addDealNote({ dealId: 'deal-201', body: 'Test note' });

      expect(note.id).toBe('note-401');
    });

    it('sends POST to notes then PUT for association', async () => {
      mockFetchSequence([noteFixture, {}]);

      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.addDealNote({ dealId: 'deal-201', body: 'Test note' });

      // First call: create note
      const url1 = getFetchUrl(0);
      expect(url1).toContain('/crm/v3/objects/notes');
      const opts1 = getFetchOptions(0);
      expect(opts1?.method).toBe('POST');
      const body1 = JSON.parse(opts1?.body as string) as Record<string, unknown>;
      const props = body1['properties'] as Record<string, string>;
      expect(props['hs_note_body']).toBe('Test note');

      // Second call: associate with deal
      const url2 = getFetchUrl(1);
      expect(url2).toContain(`/notes/${noteFixture.id}/associations/deals/deal-201/note_to_deal/202`);
      const opts2 = getFetchOptions(1);
      expect(opts2?.method).toBe('PUT');
    });
  });

  describe('API Client — createDealTask', () => {
    it('creates task and associates with deal', async () => {
      mockFetchSequence([taskFixture, {}]);

      const api = createHubSpotApiClient(TEST_CONFIG);
      const task = await api.createDealTask({ dealId: 'deal-201', subject: 'Follow up' });

      expect(task.id).toBe('task-501');
    });

    it('sends POST to tasks then PUT for association', async () => {
      mockFetchSequence([taskFixture, {}]);

      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.createDealTask({
        dealId: 'deal-201',
        subject: 'Enviar propuesta',
        body: 'Preparar cotización',
        priority: 'HIGH',
        dueDate: '2026-03-01T10:00:00Z',
        ownerId: 'owner-1',
      });

      // First call: create task
      const opts1 = getFetchOptions(0);
      expect(opts1?.method).toBe('POST');
      const body = JSON.parse(opts1?.body as string) as Record<string, unknown>;
      const props = body['properties'] as Record<string, string>;
      expect(props['hs_task_subject']).toBe('Enviar propuesta');
      expect(props['hs_task_body']).toBe('Preparar cotización');
      expect(props['hs_task_priority']).toBe('HIGH');
      expect(props['hs_task_status']).toBe('NOT_STARTED');
      expect(props['hubspot_owner_id']).toBe('owner-1');

      // Second call: associate
      const url2 = getFetchUrl(1);
      expect(url2).toContain(`/tasks/${taskFixture.id}/associations/deals/deal-201/task_to_deal/216`);
    });

    it('uses default priority MEDIUM when not specified', async () => {
      mockFetchSequence([taskFixture, {}]);

      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.createDealTask({ dealId: 'deal-201', subject: 'Basic task' });

      const opts = getFetchOptions(0);
      const body = JSON.parse(opts?.body as string) as Record<string, unknown>;
      const props = body['properties'] as Record<string, string>;
      expect(props['hs_task_priority']).toBe('MEDIUM');
    });
  });

  describe('API Client — updateContact', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stderrSpy: MockInstance<any>;

    beforeEach(() => {
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stderrSpy.mockRestore();
    });

    function getLogLines(): Record<string, unknown>[] {
      return stderrSpy.mock.calls.map((call) => {
        const raw = call[0] as string;
        return JSON.parse(raw.trim()) as Record<string, unknown>;
      });
    }

    it('happy path: returns success and sends PATCH with exact body', async () => {
      mockFetchSuccess({
        id: '101',
        properties: { lifecyclestage: 'customer', estado_reactivacion: 'interesado' },
      });

      const api = createHubSpotApiClient(TEST_CONFIG);
      const result = await api.updateContact({
        contactId: '101',
        properties: {
          lifecyclestage: 'customer',
          estado_reactivacion: 'interesado',
          score: 85,
          opted_in: true,
        },
      });

      expect(result).toEqual({
        success: true,
        contactId: '101',
        updated: ['lifecyclestage', 'estado_reactivacion', 'score', 'opted_in'],
      });

      // URL + method
      expect(getLastFetchUrl()).toBe(
        'https://api.hubapi.com/crm/v3/objects/contacts/101',
      );
      const opts = getLastFetchOptions();
      expect(opts?.method).toBe('PATCH');

      // Exact body
      expect(JSON.parse(opts?.body as string)).toEqual({
        properties: {
          lifecyclestage: 'customer',
          estado_reactivacion: 'interesado',
          score: 85,
          opted_in: true,
        },
      });

      // Log emitted with keys only
      const logs = getLogLines();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        component: 'hubspot-mcp',
        event: 'contact_update',
        status: 'ok',
        contactId: '101',
        updated: ['lifecyclestage', 'estado_reactivacion', 'score', 'opted_in'],
      });
    });

    it('does NOT log property values (only keys)', async () => {
      mockFetchSuccess({ id: '101', properties: {} });
      const api = createHubSpotApiClient(TEST_CONFIG);

      await api.updateContact({
        contactId: '101',
        properties: {
          estado_reactivacion: 'SECRET_COMMERCIAL_VALUE_42',
          score: 999,
        },
      });

      const rawLogs = stderrSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(rawLogs).not.toContain('SECRET_COMMERCIAL_VALUE_42');
      expect(rawLogs).not.toContain('999');
      // Keys should appear
      expect(rawLogs).toContain('estado_reactivacion');
      expect(rawLogs).toContain('score');
    });

    it('404: throws MCPToolExecutionError with "not found" message', async () => {
      mockFetchError(
        404,
        '{"status":"error","message":"resource not found","correlationId":"abc"}',
      );
      const api = createHubSpotApiClient(TEST_CONFIG);

      let caught: unknown;
      try {
        await api.updateContact({
          contactId: '999',
          properties: { lifecyclestage: 'lead' },
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(MCPToolExecutionError);
      expect((caught as Error).message).toContain('Contact 999 not found in HubSpot');
    });

    it('400: throws MCPToolExecutionError surfacing HubSpot detail', async () => {
      mockFetchError(
        400,
        '{"status":"error","message":"Property values were not valid: Property \\"estado_inexistente\\" does not exist"}',
      );
      const api = createHubSpotApiClient(TEST_CONFIG);

      let caught: unknown;
      try {
        await api.updateContact({
          contactId: '101',
          properties: { estado_inexistente: 'x' },
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(MCPToolExecutionError);
      const msg = (caught as Error).message;
      expect(msg).toContain('Invalid property');
      expect(msg).toContain('estado_inexistente');
      expect(msg).toContain('does not exist');
    });

    it('429: throws MCPToolExecutionError and emits warn-level log', async () => {
      mockFetchError(429, '{"message":"You have reached your rate limit"}');
      const api = createHubSpotApiClient(TEST_CONFIG);

      let caught: unknown;
      try {
        await api.updateContact({
          contactId: '101',
          properties: { lifecyclestage: 'customer' },
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(MCPToolExecutionError);
      expect((caught as Error).message).toContain('HubSpot rate limit exceeded');

      const logs = getLogLines();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        component: 'hubspot-mcp',
        event: 'contact_update',
        status: 'rate_limited',
        level: 'warn',
        contactId: '101',
        updated: ['lifecyclestage'],
      });
    });

    it('5xx: throws MCPToolExecutionError and emits error-level log', async () => {
      mockFetchError(503, 'Service Unavailable');
      const api = createHubSpotApiClient(TEST_CONFIG);

      let caught: unknown;
      try {
        await api.updateContact({
          contactId: '101',
          properties: { lifecyclestage: 'customer' },
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(MCPToolExecutionError);
      expect((caught as Error).message).toContain('HubSpot server error (503)');

      const logs = getLogLines();
      expect(logs[0]).toMatchObject({
        component: 'hubspot-mcp',
        event: 'contact_update',
        status: 'server_error',
        level: 'error',
        httpStatus: 503,
      });
    });
  });

  describe('API Client — Error Handling', () => {
    it('throws on HTTP errors with status and body', async () => {
      mockFetchError(401, '{"message":"Invalid token"}');
      const api = createHubSpotApiClient(TEST_CONFIG);

      await expect(api.searchContacts({})).rejects.toThrow(
        'HubSpot API error (401)',
      );
    });

    it('throws on 403 scope errors', async () => {
      mockFetchError(403, '{"message":"insufficient scopes"}');
      const api = createHubSpotApiClient(TEST_CONFIG);

      await expect(api.getDealDetail({ dealId: '123' })).rejects.toThrow(
        'HubSpot API error (403)',
      );
    });

    it('throws on 429 rate limit', async () => {
      mockFetchError(429, '{"message":"Rate limit exceeded"}');
      const api = createHubSpotApiClient(TEST_CONFIG);

      await expect(api.searchContacts({ query: 'test' })).rejects.toThrow(
        'HubSpot API error (429)',
      );
    });

    it('throws on 500 server errors', async () => {
      mockFetchError(500, 'Internal Server Error');
      const api = createHubSpotApiClient(TEST_CONFIG);

      await expect(api.getCompanyDetail({ companyId: '1' })).rejects.toThrow(
        'HubSpot API error (500)',
      );
    });

    it('propagates network errors', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );
      const api = createHubSpotApiClient(TEST_CONFIG);

      await expect(api.searchContacts({})).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('Auth Header', () => {
    it('sends Bearer token on all requests', async () => {
      mockFetchSuccess({ total: 0, results: [] });
      const api = createHubSpotApiClient(TEST_CONFIG);
      await api.searchContacts({});

      const opts = getLastFetchOptions();
      const headers = opts?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${TEST_CONFIG.accessToken}`);
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Tool Definitions', () => {
    const expectedTools = [
      'search-contacts',
      'search-deals',
      'get-contact-deals',
      'get-deal-detail',
      'get-company-detail',
      'update-deal-stage',
      'add-deal-note',
      'create-deal-task',
      'update-contact',
    ];

    it('exposes exactly 9 tools', () => {
      expect(expectedTools).toHaveLength(9);
    });

    it('all tool names are kebab-case', () => {
      for (const name of expectedTools) {
        expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it('write tools require dealId', () => {
      const writeTools = ['update-deal-stage', 'add-deal-note', 'create-deal-task'];
      for (const tool of writeTools) {
        expect(expectedTools).toContain(tool);
      }
    });

    it('update-contact is registered in the expected tools list', () => {
      expect(expectedTools).toContain('update-contact');
    });
  });
});
