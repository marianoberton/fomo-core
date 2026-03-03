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
export type CampaignSendStatus = 'queued' | 'sent' | 'failed' | 'replied' | 'converted';
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

// ─── Reply & Metrics ────────────────────────────────────────────

/** Record of a contact replying to a campaign message. */
export interface CampaignReply {
  id: string;
  campaignSendId: CampaignSendId;
  contactId: ContactId;
  /** Session where the contact replied. */
  sessionId: string;
  repliedAt: Date;
  /** Number of messages exchanged in the session. */
  messageCount: number;
  /** Whether the agent marked this as a conversion. */
  converted: boolean;
  /** Type of conversion (purchase, inquiry, etc.). */
  conversionNote?: string;
}

/** Aggregated metrics for a campaign. */
export interface CampaignMetrics {
  campaignId: CampaignId;
  totalSent: number;
  totalFailed: number;
  totalReplied: number;
  totalConverted: number;
  /** totalReplied / totalSent (0-1). */
  replyRate: number;
  /** totalConverted / totalSent (0-1). */
  conversionRate: number;
  /** Average milliseconds until first reply, or null if no replies yet. */
  avgResponseTimeMs: number | null;
  breakdown: {
    byDay: Array<{ date: string; sent: number; replied: number; converted: number }>;
  };
}

// ─── Execution Result ───────────────────────────────────────────

export interface CampaignExecutionResult {
  campaignId: CampaignId;
  totalContacts: number;
  sent: number;
  failed: number;
  skipped: number;
}
