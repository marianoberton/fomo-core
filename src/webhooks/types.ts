import type { ProjectId } from '@/core/types.js';

// ─── Webhook ID ─────────────────────────────────────────────────

export type WebhookId = string;

// ─── Webhook Config ─────────────────────────────────────────────

export interface Webhook {
  id: WebhookId;
  projectId: ProjectId;
  agentId?: string;

  name: string;
  description?: string;

  /**
   * Template for the message to send to the agent.
   * Uses Mustache-style placeholders: {{field.path}}
   * Example: "New lead received: {{name}} ({{email}})"
   */
  triggerPrompt: string;

  /** Secret for HMAC validation (optional) */
  secretEnvVar?: string;

  /** Allowed IP addresses (optional, empty = allow all) */
  allowedIps?: string[];

  status: 'active' | 'paused';

  createdAt: Date;
  updatedAt: Date;
}

// ─── Create/Update Inputs ───────────────────────────────────────

export interface CreateWebhookInput {
  projectId: ProjectId;
  agentId?: string;
  name: string;
  description?: string;
  triggerPrompt: string;
  secretEnvVar?: string;
  allowedIps?: string[];
  status?: 'active' | 'paused';
}

export interface UpdateWebhookInput {
  agentId?: string;
  name?: string;
  description?: string;
  triggerPrompt?: string;
  secretEnvVar?: string;
  allowedIps?: string[];
  status?: 'active' | 'paused';
}

// ─── Webhook Event ──────────────────────────────────────────────

export interface WebhookEvent {
  webhookId: WebhookId;
  payload: unknown;
  headers: Record<string, string>;
  sourceIp?: string;
  receivedAt: Date;
}

// ─── Webhook Execution Result ───────────────────────────────────

export interface WebhookExecutionResult {
  success: boolean;
  sessionId?: string;
  response?: string;
  error?: string;
  durationMs: number;
}

// ─── Repository Interface ───────────────────────────────────────

export interface WebhookRepository {
  create(input: CreateWebhookInput): Promise<Webhook>;
  findById(id: WebhookId): Promise<Webhook | null>;
  update(id: WebhookId, input: UpdateWebhookInput): Promise<Webhook>;
  delete(id: WebhookId): Promise<void>;
  list(projectId: ProjectId): Promise<Webhook[]>;
  listActive(projectId: ProjectId): Promise<Webhook[]>;
}
