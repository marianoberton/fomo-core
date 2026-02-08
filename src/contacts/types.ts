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
