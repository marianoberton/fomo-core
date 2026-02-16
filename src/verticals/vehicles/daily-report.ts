/**
 * Daily Report Service for Vehicle Sales
 *
 * Generates daily summaries of leads, follow-ups, and sales activity
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const LeadSummarySchema = z.object({
  contactId: z.string(),
  name: z.string(),
  tier: z.enum(['cold', 'warm', 'hot', 'urgent']),
  score: z.number(),
  lastInteraction: z.string().datetime(),
  urgency: z.string(),
  budgetRange: z.string().optional(),
  needsFollowUp: z.boolean(),
});

export type LeadSummary = z.infer<typeof LeadSummarySchema>;

export interface DailyReportData {
  date: string;
  newLeads: LeadSummary[];
  followUpsNeeded: LeadSummary[];
  hotLeads: LeadSummary[];
  urgentLeads: LeadSummary[];
  totalLeads: number;
  leadsByTier: {
    urgent: number;
    hot: number;
    warm: number;
    cold: number;
  };
  averageScore: number;
}

export interface DailyReport {
  summary: string;
  details: DailyReportData;
  actionItems: string[];
}

// ─── Report Generation ──────────────────────────────────────────

/**
 * Generate daily report from lead data
 */
export function generateDailyReport(leads: LeadSummary[]): DailyReport {
  const today = new Date().toISOString().split('T')[0] ?? '';

  // Filter new leads (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const newLeads = leads.filter(
    (lead) => new Date(lead.lastInteraction) >= oneDayAgo
  );

  // Categorize leads
  const urgentLeads = leads.filter((lead) => lead.tier === 'urgent');
  const hotLeads = leads.filter((lead) => lead.tier === 'hot');
  const followUpsNeeded = leads.filter((lead) => lead.needsFollowUp);

  // Calculate statistics
  const leadsByTier = {
    urgent: leads.filter((l) => l.tier === 'urgent').length,
    hot: leads.filter((l) => l.tier === 'hot').length,
    warm: leads.filter((l) => l.tier === 'warm').length,
    cold: leads.filter((l) => l.tier === 'cold').length,
  };

  const averageScore =
    leads.length > 0
      ? Math.round(leads.reduce((sum, lead) => sum + lead.score, 0) / leads.length)
      : 0;

  const details: DailyReportData = {
    date: today,
    newLeads,
    followUpsNeeded,
    hotLeads,
    urgentLeads,
    totalLeads: leads.length,
    leadsByTier,
    averageScore,
  };

  const summary = buildSummaryText(details);
  const actionItems = buildActionItems(details);

  return {
    summary,
    details,
    actionItems,
  };
}

/**
 * Build human-readable summary text
 */
function buildSummaryText(data: DailyReportData): string {
  const parts: string[] = [];

  parts.push(`📊 REPORTE DIARIO - ${data.date}`);
  parts.push('');
  parts.push(`Total de leads: ${data.totalLeads}`);
  parts.push(`Leads nuevos (últimas 24hs): ${data.newLeads.length}`);
  parts.push(`Score promedio: ${data.averageScore}/100`);
  parts.push('');
  parts.push('Distribución por nivel:');
  parts.push(`🔥 URGENTES: ${data.leadsByTier.urgent}`);
  parts.push(`🌡️  HOT: ${data.leadsByTier.hot}`);
  parts.push(`📈 WARM: ${data.leadsByTier.warm}`);
  parts.push(`❄️  COLD: ${data.leadsByTier.cold}`);
  parts.push('');

  if (data.urgentLeads.length > 0) {
    parts.push('⚡ LEADS URGENTES (requieren atención inmediata):');
    data.urgentLeads.slice(0, 5).forEach((lead) => {
      parts.push(
        `  - ${lead.name} (${lead.score}/100) - última interacción: ${formatRelativeTime(lead.lastInteraction)}`
      );
    });
    if (data.urgentLeads.length > 5) {
      parts.push(`  ... y ${data.urgentLeads.length - 5} más`);
    }
    parts.push('');
  }

  if (data.followUpsNeeded.length > 0) {
    parts.push('📞 FOLLOW-UPS PENDIENTES:');
    data.followUpsNeeded.slice(0, 5).forEach((lead) => {
      parts.push(
        `  - ${lead.name} (${lead.tier.toUpperCase()}) - ${formatRelativeTime(lead.lastInteraction)}`
      );
    });
    if (data.followUpsNeeded.length > 5) {
      parts.push(`  ... y ${data.followUpsNeeded.length - 5} más`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Build actionable to-do items
 */
function buildActionItems(data: DailyReportData): string[] {
  const items: string[] = [];

  if (data.urgentLeads.length > 0) {
    items.push(
      `Contactar AHORA a ${data.urgentLeads.length} lead${data.urgentLeads.length > 1 ? 's' : ''} urgente${data.urgentLeads.length > 1 ? 's' : ''}`
    );
  }

  if (data.hotLeads.length > 0) {
    items.push(
      `Seguimiento prioritario a ${data.hotLeads.length} lead${data.hotLeads.length > 1 ? 's' : ''} HOT en las próximas 4 horas`
    );
  }

  if (data.followUpsNeeded.length > 0) {
    items.push(
      `Realizar ${data.followUpsNeeded.length} follow-up${data.followUpsNeeded.length > 1 ? 's' : ''} pendiente${data.followUpsNeeded.length > 1 ? 's' : ''}`
    );
  }

  if (data.newLeads.length > 5) {
    items.push(
      `Alto volumen de leads nuevos (${data.newLeads.length}) - considerar asignar recursos adicionales`
    );
  }

  if (data.averageScore < 30 && data.totalLeads > 10) {
    items.push(
      'Score promedio bajo - revisar estrategia de calificación o fuentes de leads'
    );
  }

  if (items.length === 0) {
    items.push('Sin acciones urgentes. Mantener seguimiento de rutina.');
  }

  return items;
}

/**
 * Format datetime as relative time
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `hace ${diffMins}min`;
  } else if (diffHours < 24) {
    return `hace ${diffHours}h`;
  } else if (diffDays < 7) {
    return `hace ${diffDays}d`;
  } else {
    return date.toLocaleDateString('es-AR');
  }
}

/**
 * Format report for WhatsApp/Telegram
 */
export function formatReportForMessaging(report: DailyReport): string {
  return report.summary;
}

/**
 * Format report for email (with more details)
 */
export function formatReportForEmail(report: DailyReport): {
  subject: string;
  body: string;
} {
  const subject = `Reporte Diario Vehículos - ${report.details.date}`;
  const body = [
    report.summary,
    '',
    '═'.repeat(50),
    '',
    '✅ ACCIONES RECOMENDADAS:',
    ...report.actionItems.map((item, i) => `${i + 1}. ${item}`),
  ].join('\n');

  return { subject, body };
}
