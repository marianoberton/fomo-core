/**
 * Supabase PostgREST API client for Fomo Platform.
 *
 * Calls Supabase REST API directly via fetch — no @supabase/supabase-js needed.
 * Uses service role key to bypass RLS, manually scopes by company_id.
 *
 * Required env vars:
 *   SUPABASE_URL       — Supabase project URL (e.g. https://xxx.supabase.co)
 *   SUPABASE_SERVICE_KEY — Service role key
 *   FOMO_COMPANY_ID    — Company UUID to scope all operations
 */

// ─── Response Types ──────────────────────────────────────────────────

export interface ClientRecord {
  id: string;
  company_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  cuit: string | null;
  website_url: string | null;
  notes: string | null;
  source: string | null;
  tags: string[];
  portal_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientDetailRecord extends ClientRecord {
  crm_contacts: ContactRecord[];
  temas: TemaRefRecord[];
}

export interface ContactRecord {
  id: string;
  company_id: string;
  client_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  is_primary: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpportunityRecord {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  client_id: string | null;
  assigned_to: string | null;
  stage: string;
  outcome: string | null;
  probability: number;
  estimated_value: number;
  weighted_value: number;
  currency: string;
  expected_close_date: string | null;
  closed_at: string | null;
  loss_reason: string | null;
  created_at: string;
  updated_at: string;
  clients: { name: string } | null;
}

export interface TemaRecord {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  reference_code: string | null;
  expediente_number: string | null;
  organismo: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  tema_types: { name: string; color: string } | null;
}

export interface TemaRefRecord {
  id: string;
  title: string;
  status: string;
  priority: string;
  reference_code: string | null;
  due_date: string | null;
}

export interface TemaTaskRecord {
  id: string;
  tema_id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  sort_order: number;
  due_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Config ──────────────────────────────────────────────────────────

export interface FomoApiConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  companyId: string;
}

// ─── Client Factory ──────────────────────────────────────────────────

/** API client interface for Fomo Platform. */
export interface FomoApiClient {
  searchClients(params: { query?: string; limit?: number }): Promise<ClientRecord[]>;
  getClientDetail(clientId: string): Promise<ClientDetailRecord>;
  listContacts(params: { clientId?: string; query?: string; limit?: number }): Promise<ContactRecord[]>;
  listOpportunities(params: { stage?: string; clientId?: string; limit?: number }): Promise<OpportunityRecord[]>;
  updateOpportunityStage(params: { opportunityId: string; stage: string; outcome?: string; lossReason?: string }): Promise<OpportunityRecord>;
  listTemas(params: { status?: string; priority?: string; query?: string; limit?: number }): Promise<TemaRecord[]>;
  createTemaTask(params: { temaId: string; title: string; description?: string; assignedTo?: string; dueDate?: string }): Promise<TemaTaskRecord>;
}

/** Create a Fomo API client for accessing CRM data via Supabase PostgREST. */
export function createFomoApiClient(config: FomoApiConfig): FomoApiClient {
  const { supabaseUrl, serviceRoleKey, companyId } = config;
  const restUrl = `${supabaseUrl}/rest/v1`;

  function makeHeaders(): Record<string, string> {
    return {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
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
      throw new Error(`Supabase API error (${String(res.status)}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    /**
     * Search CRM clients by name, email, or CUIT.
     */
    async searchClients(params: {
      query?: string;
      limit?: number;
    }): Promise<ClientRecord[]> {
      const sp = new URLSearchParams();
      sp.set('company_id', `eq.${companyId}`);
      sp.set('select', '*');
      sp.set('order', 'name.asc');
      sp.set('limit', String(params.limit ?? 20));
      if (params.query) {
        const q = params.query;
        sp.set(
          'or',
          `(name.ilike.*${q}*,email.ilike.*${q}*,cuit.ilike.*${q}*)`,
        );
      }
      return fetchJson<ClientRecord[]>(`${restUrl}/clients?${sp.toString()}`);
    },

    /**
     * Get a single client with contacts and related temas.
     */
    async getClientDetail(clientId: string): Promise<ClientDetailRecord> {
      const sp = new URLSearchParams();
      sp.set('id', `eq.${clientId}`);
      sp.set('company_id', `eq.${companyId}`);
      sp.set(
        'select',
        '*,crm_contacts(*),temas(id,title,status,priority,reference_code,due_date)',
      );
      const results = await fetchJson<ClientDetailRecord[]>(
        `${restUrl}/clients?${sp.toString()}`,
      );
      const client = results[0];
      if (!client) {
        throw new Error(`Client not found: ${clientId}`);
      }
      return client;
    },

    /**
     * List CRM contacts (optionally filtered by client).
     */
    async listContacts(params: {
      clientId?: string;
      query?: string;
      limit?: number;
    }): Promise<ContactRecord[]> {
      const sp = new URLSearchParams();
      sp.set('company_id', `eq.${companyId}`);
      sp.set('select', '*');
      sp.set('order', 'first_name.asc');
      sp.set('limit', String(params.limit ?? 30));
      if (params.clientId) {
        sp.set('client_id', `eq.${params.clientId}`);
      }
      if (params.query) {
        const q = params.query;
        sp.set(
          'or',
          `(first_name.ilike.*${q}*,last_name.ilike.*${q}*,email.ilike.*${q}*)`,
        );
      }
      return fetchJson<ContactRecord[]>(
        `${restUrl}/crm_contacts?${sp.toString()}`,
      );
    },

    /**
     * List sales pipeline opportunities.
     */
    async listOpportunities(params: {
      stage?: string;
      clientId?: string;
      limit?: number;
    }): Promise<OpportunityRecord[]> {
      const sp = new URLSearchParams();
      sp.set('company_id', `eq.${companyId}`);
      sp.set('select', '*,clients(name)');
      sp.set('order', 'updated_at.desc');
      sp.set('limit', String(params.limit ?? 20));
      if (params.stage) {
        sp.set('stage', `eq.${params.stage}`);
      }
      if (params.clientId) {
        sp.set('client_id', `eq.${params.clientId}`);
      }
      return fetchJson<OpportunityRecord[]>(
        `${restUrl}/opportunities?${sp.toString()}`,
      );
    },

    /**
     * Move an opportunity to a new pipeline stage.
     */
    async updateOpportunityStage(params: {
      opportunityId: string;
      stage: string;
      outcome?: string;
      lossReason?: string;
    }): Promise<OpportunityRecord> {
      const sp = new URLSearchParams();
      sp.set('id', `eq.${params.opportunityId}`);
      sp.set('company_id', `eq.${companyId}`);

      const body: Record<string, unknown> = {
        stage: params.stage,
        updated_at: new Date().toISOString(),
      };

      // Set probability based on stage
      const stageProbability: Record<string, number> = {
        calificacion: 25,
        propuesta: 50,
        negociacion: 75,
        cierre: 100,
      };
      const prob = stageProbability[params.stage];
      if (prob !== undefined) {
        body['probability'] = prob;
      }

      if (params.stage === 'cierre') {
        body['outcome'] = params.outcome ?? 'won';
        body['closed_at'] = new Date().toISOString();
        if (params.outcome === 'lost') {
          body['probability'] = 0;
          if (params.lossReason) {
            body['loss_reason'] = params.lossReason;
          }
        }
      }

      const results = await fetchJson<OpportunityRecord[]>(
        `${restUrl}/opportunities?${sp.toString()}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
      const opp = results[0];
      if (!opp) {
        throw new Error(`Opportunity not found: ${params.opportunityId}`);
      }
      return opp;
    },

    /**
     * List temas (projects/cases) with filters.
     */
    async listTemas(params: {
      status?: string;
      priority?: string;
      query?: string;
      limit?: number;
    }): Promise<TemaRecord[]> {
      const sp = new URLSearchParams();
      sp.set('company_id', `eq.${companyId}`);
      sp.set('select', '*,tema_types(name,color)');
      sp.set('order', 'updated_at.desc');
      sp.set('limit', String(params.limit ?? 20));
      if (params.status) {
        sp.set('status', `eq.${params.status}`);
      }
      if (params.priority) {
        sp.set('priority', `eq.${params.priority}`);
      }
      if (params.query) {
        const q = params.query;
        sp.set(
          'or',
          `(title.ilike.*${q}*,reference_code.ilike.*${q}*,description.ilike.*${q}*)`,
        );
      }
      return fetchJson<TemaRecord[]>(`${restUrl}/temas?${sp.toString()}`);
    },

    /**
     * Create a task within a tema.
     */
    async createTemaTask(params: {
      temaId: string;
      title: string;
      description?: string;
      assignedTo?: string;
      dueDate?: string;
    }): Promise<TemaTaskRecord> {
      const body: Record<string, unknown> = {
        tema_id: params.temaId,
        title: params.title,
        status: 'pending',
      };
      if (params.description) body['description'] = params.description;
      if (params.assignedTo) body['assigned_to'] = params.assignedTo;
      if (params.dueDate) body['due_date'] = params.dueDate;

      const results = await fetchJson<TemaTaskRecord[]>(
        `${restUrl}/tema_tasks`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      const task = results[0];
      if (!task) {
        throw new Error('Failed to create task — no result returned');
      }
      return task;
    },
  };
}
