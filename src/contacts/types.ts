import type { ProjectId } from '@/core/types.js';

// ─── Contact ID ─────────────────────────────────────────────────

export type ContactId = string;

// ─── Contact ────────────────────────────────────────────────────

export interface Contact {
  id: ContactId;
  projectId: ProjectId;
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language: string;
  /** Contact role — e.g. 'owner', 'staff', 'customer', or undefined for default. */
  role?: string;
  /** Arbitrary labels — e.g. ["vip", "wholesale", "prospect"]. */
  tags: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Create/Update Inputs ───────────────────────────────────────

export interface CreateContactInput {
  projectId: ProjectId;
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language?: string;
  role?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateContactInput {
  name?: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language?: string;
  role?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ─── Channel Identifier ─────────────────────────────────────────

export type ChannelIdentifier =
  | { type: 'phone'; value: string }
  | { type: 'email'; value: string }
  | { type: 'telegramId'; value: string }
  | { type: 'slackId'; value: string };

// ─── List Options ───────────────────────────────────────────────

export interface ContactListOptions {
  limit?: number;
  offset?: number;
}

// ─── Repository Interface ───────────────────────────────────────

export interface ContactRepository {
  create(input: CreateContactInput): Promise<Contact>;
  findById(id: ContactId): Promise<Contact | null>;
  findByChannel(projectId: ProjectId, identifier: ChannelIdentifier): Promise<Contact | null>;
  update(id: ContactId, input: UpdateContactInput): Promise<Contact>;
  delete(id: ContactId): Promise<void>;
  list(projectId: ProjectId, options?: ContactListOptions): Promise<Contact[]>;
}

// ─── Contact Scoring ─────────────────────────────────────────────

export interface ContactScore {
  contactId: ContactId;
  projectId: ProjectId;
  score: number; // 0-100
  tier: 'hot' | 'warm' | 'cold' | 'inactive';
  signals: ScoreSignal[]; // qué contribuyó al score
  lastScoredAt: Date;
  nextFollowUpAt?: Date; // sugerencia de cuándo hacer follow-up
}

export interface ScoreSignal {
  name: string; // ej: 'recent_session', 'high_message_count', 'escalated'
  weight: number; // contribución al score (puede ser negativa)
  detail?: string; // descripción legible
}

export interface ScoringRule {
  name: string;
  description: string;
  /** Peso base de esta regla (-100 a 100). */
  weight: number;
  /** Condición evaluada sobre el ContactScoringContext. */
  condition: ScoringCondition;
}

export type ScoringCondition =
  | { type: 'has_tag'; tag: string }
  | { type: 'min_sessions'; count: number; withinDays?: number }
  | { type: 'min_messages'; count: number; withinDays?: number }
  | { type: 'last_session_within_days'; days: number }
  | { type: 'no_session_since_days'; days: number }
  | { type: 'was_escalated' }
  | { type: 'has_role'; role: string }
  | { type: 'metadata_equals'; key: string; value: unknown };

export interface ScoringConfig {
  /** Reglas a aplicar en orden. */
  rules: ScoringRule[];
  /** Umbrales para los tiers. */
  tiers: {
    hot: number; // score >= hot → 'hot'
    warm: number; // score >= warm → 'warm'
    cold: number; // score >= cold → 'cold'
    // < cold → 'inactive'
  };
  /** Días sin sesión para sugerir follow-up. Default: 3. */
  followUpAfterDays?: number;
}

export interface ContactScoringContext {
  contact: Contact;
  sessionCount: number;
  messageCount: number;
  lastSessionAt: Date | null;
  wasEscalated: boolean;
  daysSinceLastSession: number | null;
}
