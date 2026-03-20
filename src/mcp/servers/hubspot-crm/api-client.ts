/**
 * HubSpot CRM API v3 client.
 *
 * Calls HubSpot REST API directly via fetch — no SDK needed.
 * Uses a Private App access token for authentication.
 *
 * Required env vars:
 *   HUBSPOT_ACCESS_TOKEN — HubSpot Private App token
 */

// ─── Response Types ──────────────────────────────────────────────────

export interface HSContact {
  id: string;
  properties: Record<string, string | null>;
}

export interface HSDeal {
  id: string;
  properties: Record<string, string | null>;
  associations?: {
    contacts?: { results: HSAssociation[] };
    companies?: { results: HSAssociation[] };
  };
}

export interface HSCompany {
  id: string;
  properties: Record<string, string | null>;
}

export interface HSAssociation {
  id: string;
  type: string;
}

export interface HSNote {
  id: string;
  properties: Record<string, string | null>;
}

export interface HSTask {
  id: string;
  properties: Record<string, string | null>;
}

export interface HSSearchResponse<T> {
  total: number;
  results: T[];
  paging?: { next?: { after: string } };
}

export interface HSBatchReadResponse<T> {
  results: T[];
  status: string;
}

// ─── Config ──────────────────────────────────────────────────────────

export interface HubSpotApiConfig {
  accessToken: string;
}

// ─── Client Interface ────────────────────────────────────────────────

export interface HubSpotApiClient {
  searchContacts(params: { query?: string; email?: string; phone?: string; limit?: number }): Promise<HSSearchResponse<HSContact>>;
  searchDeals(params: { stage?: string; pipeline?: string; inactiveDays?: number; ownerId?: string; limit?: number }): Promise<HSSearchResponse<HSDeal>>;
  getContactDeals(params: { contactId: string; limit?: number }): Promise<HSDeal[]>;
  getDealDetail(params: { dealId: string }): Promise<HSDeal>;
  getCompanyDetail(params: { companyId: string }): Promise<HSCompany>;
  updateDealStage(params: { dealId: string; stage: string; pipeline?: string }): Promise<HSDeal>;
  addDealNote(params: { dealId: string; body: string }): Promise<HSNote>;
  createDealTask(params: { dealId: string; subject: string; body?: string; priority?: string; dueDate?: string; ownerId?: string }): Promise<HSTask>;
}

// ─── Client Factory ──────────────────────────────────────────────────

const BASE_URL = 'https://api.hubapi.com';

const CONTACT_PROPERTIES = [
  'firstname', 'lastname', 'email', 'phone', 'company',
  'lifecyclestage', 'createdate', 'lastmodifieddate',
];

const DEAL_PROPERTIES = [
  'dealname', 'dealstage', 'pipeline', 'amount', 'closedate',
  'createdate', 'lastmodifieddate', 'hubspot_owner_id', 'description',
];

const COMPANY_PROPERTIES = [
  'name', 'domain', 'industry', 'phone', 'city', 'state', 'country',
  'numberofemployees', 'annualrevenue', 'createdate', 'lastmodifieddate',
];

/** Create a HubSpot API client for accessing CRM data. */
export function createHubSpotApiClient(config: HubSpotApiConfig): HubSpotApiClient {
  const { accessToken } = config;

  function makeHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...makeHeaders(),
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HubSpot API error (${String(res.status)}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  /** Strip non-digit characters for phone comparison. */
  function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  return {
    /**
     * Search HubSpot contacts by phone, email, or name.
     */
    async searchContacts(params: {
      query?: string;
      email?: string;
      phone?: string;
      limit?: number;
    }): Promise<HSSearchResponse<HSContact>> {
      const filterGroups: { filters: { propertyName: string; operator: string; value: string }[] }[] = [];

      if (params.email) {
        filterGroups.push({
          filters: [{ propertyName: 'email', operator: 'EQ', value: params.email }],
        });
      }

      if (params.phone) {
        const normalized = normalizePhone(params.phone);
        filterGroups.push({
          filters: [{ propertyName: 'phone', operator: 'CONTAINS_TOKEN', value: `*${normalized}` }],
        });
      }

      if (params.query) {
        // Search across name and email
        filterGroups.push({
          filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: `*${params.query}*` }],
        });
        filterGroups.push({
          filters: [{ propertyName: 'lastname', operator: 'CONTAINS_TOKEN', value: `*${params.query}*` }],
        });
        filterGroups.push({
          filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: `*${params.query}*` }],
        });
      }

      const body = {
        ...(filterGroups.length > 0 ? { filterGroups } : {}),
        properties: CONTACT_PROPERTIES,
        limit: Math.min(params.limit ?? 10, 100),
      };

      return fetchJson<HSSearchResponse<HSContact>>(
        `${BASE_URL}/crm/v3/objects/contacts/search`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },

    /**
     * Search HubSpot deals by stage, pipeline, inactivity, or owner.
     * Filters within a single call are ANDed. Results sorted by last modified (oldest first).
     */
    async searchDeals(params: {
      stage?: string;
      pipeline?: string;
      inactiveDays?: number;
      ownerId?: string;
      limit?: number;
    }): Promise<HSSearchResponse<HSDeal>> {
      const filters: { propertyName: string; operator: string; value: string }[] = [];

      if (params.stage) {
        filters.push({ propertyName: 'dealstage', operator: 'EQ', value: params.stage });
      }

      if (params.pipeline) {
        filters.push({ propertyName: 'pipeline', operator: 'EQ', value: params.pipeline });
      }

      if (params.inactiveDays !== undefined && params.inactiveDays > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - params.inactiveDays);
        filters.push({
          propertyName: 'notes_last_updated',
          operator: 'LT',
          value: cutoff.getTime().toString(),
        });
      }

      if (params.ownerId) {
        filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: params.ownerId });
      }

      const body: Record<string, unknown> = {
        properties: DEAL_PROPERTIES,
        limit: Math.min(params.limit ?? 20, 100),
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
      };

      if (filters.length > 0) {
        body['filterGroups'] = [{ filters }];
      }

      return fetchJson<HSSearchResponse<HSDeal>>(
        `${BASE_URL}/crm/v3/objects/deals/search`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },

    /**
     * Get all deals associated with a HubSpot contact.
     */
    async getContactDeals(params: {
      contactId: string;
      limit?: number;
    }): Promise<HSDeal[]> {
      // Step 1: Get associated deal IDs
      const assocResponse = await fetchJson<{ results: HSAssociation[] }>(
        `${BASE_URL}/crm/v3/objects/contacts/${params.contactId}/associations/deals`,
      );

      if (assocResponse.results.length === 0) return [];

      const dealIds = assocResponse.results
        .slice(0, params.limit ?? 10)
        .map((a) => ({ id: a.id }));

      // Step 2: Batch read deal details
      const batchResponse = await fetchJson<HSBatchReadResponse<HSDeal>>(
        `${BASE_URL}/crm/v3/objects/deals/batch/read`,
        {
          method: 'POST',
          body: JSON.stringify({
            inputs: dealIds,
            properties: DEAL_PROPERTIES,
          }),
        },
      );

      return batchResponse.results;
    },

    /**
     * Get full deal details with associated contacts and companies.
     */
    async getDealDetail(params: { dealId: string }): Promise<HSDeal> {
      const properties = DEAL_PROPERTIES.join(',');
      return fetchJson<HSDeal>(
        `${BASE_URL}/crm/v3/objects/deals/${params.dealId}?properties=${properties}&associations=contacts,companies`,
      );
    },

    /**
     * Get company info by ID.
     */
    async getCompanyDetail(params: { companyId: string }): Promise<HSCompany> {
      const properties = COMPANY_PROPERTIES.join(',');
      return fetchJson<HSCompany>(
        `${BASE_URL}/crm/v3/objects/companies/${params.companyId}?properties=${properties}`,
      );
    },

    /**
     * Move a deal to a new pipeline stage.
     */
    async updateDealStage(params: {
      dealId: string;
      stage: string;
      pipeline?: string;
    }): Promise<HSDeal> {
      const properties: Record<string, string> = { dealstage: params.stage };
      if (params.pipeline) {
        properties['pipeline'] = params.pipeline;
      }

      return fetchJson<HSDeal>(
        `${BASE_URL}/crm/v3/objects/deals/${params.dealId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ properties }),
        },
      );
    },

    /**
     * Add a note/engagement to a deal.
     */
    async addDealNote(params: { dealId: string; body: string }): Promise<HSNote> {
      // Step 1: Create the note
      const note = await fetchJson<HSNote>(
        `${BASE_URL}/crm/v3/objects/notes`,
        {
          method: 'POST',
          body: JSON.stringify({
            properties: {
              hs_note_body: params.body,
              hs_timestamp: new Date().toISOString(),
            },
          }),
        },
      );

      // Step 2: Associate with the deal (note_to_deal = 202)
      await fetchJson<unknown>(
        `${BASE_URL}/crm/v3/objects/notes/${note.id}/associations/deals/${params.dealId}/note_to_deal/202`,
        { method: 'PUT' },
      );

      return note;
    },

    /**
     * Create a task linked to a deal.
     */
    async createDealTask(params: {
      dealId: string;
      subject: string;
      body?: string;
      priority?: string;
      dueDate?: string;
      ownerId?: string;
    }): Promise<HSTask> {
      const properties: Record<string, string> = {
        hs_task_subject: params.subject,
        hs_task_body: params.body ?? '',
        hs_task_status: 'NOT_STARTED',
        hs_task_priority: params.priority ?? 'MEDIUM',
        hs_timestamp: params.dueDate ?? new Date().toISOString(),
      };
      if (params.ownerId) {
        properties['hubspot_owner_id'] = params.ownerId;
      }

      // Step 1: Create the task
      const task = await fetchJson<HSTask>(
        `${BASE_URL}/crm/v3/objects/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({ properties }),
        },
      );

      // Step 2: Associate with the deal (task_to_deal = 216)
      await fetchJson<unknown>(
        `${BASE_URL}/crm/v3/objects/tasks/${task.id}/associations/deals/${params.dealId}/task_to_deal/216`,
        { method: 'PUT' },
      );

      return task;
    },
  };
}
