/**
 * Campaign system types — outbound campaigns with audience filtering.
 */
import type { ProjectId } from '@/core/types.js';
import type { ContactId } from '@/contacts/types.js';

// ─── Branded Types ──────────────────────────────────────────────

export type CampaignId = string & { readonly __brand: 'CampaignId' };
export type CampaignSendId = string & { readonly __brand: 'CampaignSendId' };

// ─── Enums ──────────────────────────────────────────────────────

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';
export type CampaignSendStatus = 'queued' | 'sent' | 'failed';
export type CampaignChannel = 'whatsapp' | 'telegram' | 'slack';

// ─── Audience Filter ────────────────────────────────────────────

/** Filter criteria for selecting campaign recipients. */
export interface AudienceFilter {
  /** Contacts must have ALL of these tags. */
  tags?: string[];
  /** Contacts must match this role (e.g. 'customer', 'owner'). */
  role?: string;
}

// ─── Domain Types ───────────────────────────────────────────────

export interface Campaign {
  id: CampaignId;
  projectId: ProjectId;
  name: string;
  status: CampaignStatus;
  /** Mustache-style template: "Hola {{name}}, ..." */
  template: string;
  /** Channel to send through. */
  channel: CampaignChannel;
  /** Audience selection criteria. */
  audienceFilter: AudienceFilter;
  scheduledFor?: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignSend {
  id: CampaignSendId;
  campaignId: CampaignId;
  contactId: ContactId;
  status: CampaignSendStatus;
  error?: string;
  sentAt?: Date;
  createdAt: Date;
}

// ─── Execution Result ───────────────────────────────────────────

export interface CampaignExecutionResult {
  campaignId: CampaignId;
  totalContacts: number;
  sent: number;
  failed: number;
  skipped: number;
}
