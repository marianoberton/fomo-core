# Nexus Core — Source: Verticals + Templates

Industry-specific implementations and agent templates.

---
## src/verticals/hotels/multi-language.ts
```typescript
/**
 * Multi-Language Service for Hotels
 *
 * Detects language and maintains consistent responses in customer's preferred language
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const SupportedLanguageSchema = z.enum([
  'es', // Spanish
  'en', // English
  'pt', // Portuguese
  'fr', // French
  'de', // German
  'it', // Italian
]);

export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export interface LanguageDetection {
  language: SupportedLanguage;
  confidence: 'high' | 'medium' | 'low';
  fallback: boolean;
}

export interface TranslationKey {
  greeting: string;
  farewell: string;
  confirmReservation: string;
  checkAvailability: string;
  priceInquiry: string;
  thanksMessage: string;
}

// ─── Language Detection ─────────────────────────────────────────

const LANGUAGE_PATTERNS: Record<SupportedLanguage, RegExp[]> = {
  es: [
    /\b(hola|buenos días|buenas tardes|gracias|por favor|habitación|reserva|disponibilidad)\b/i,
    /\b(cuánto|precio|costo|quisiera|necesito)\b/i,
  ],
  en: [
    /\b(hello|hi|good morning|good afternoon|thank you|please|room|reservation|availability)\b/i,
    /\b(how much|price|cost|would like|need)\b/i,
  ],
  pt: [
    /\b(olá|bom dia|boa tarde|obrigado|por favor|quarto|reserva|disponibilidade)\b/i,
    /\b(quanto|preço|custo|gostaria|preciso)\b/i,
  ],
  fr: [
    /\b(bonjour|bonsoir|merci|s'il vous plaît|chambre|réservation|disponibilité)\b/i,
    /\b(combien|prix|coût|voudrais|besoin)\b/i,
  ],
  de: [
    /\b(hallo|guten tag|guten morgen|danke|bitte|zimmer|reservierung|verfügbarkeit)\b/i,
    /\b(wie viel|preis|kosten|möchte|brauche)\b/i,
  ],
  it: [
    /\b(ciao|buongiorno|buonasera|grazie|per favore|camera|prenotazione|disponibilità)\b/i,
    /\b(quanto|prezzo|costo|vorrei|bisogno)\b/i,
  ],
};

/**
 * Detect language from text
 */
export function detectLanguage(text: string): LanguageDetection {
  const normalized = text.toLowerCase();
  const scores: Partial<Record<SupportedLanguage, number>> = {};

  // Score each language based on pattern matches
  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        score++;
      }
    }
    if (score > 0) {
      scores[lang as SupportedLanguage] = score;
    }
  }

  // Find language with highest score
  const entries = Object.entries(scores) as [SupportedLanguage, number][];
  if (entries.length === 0) {
    // No match, fallback to Spanish
    return {
      language: 'es',
      confidence: 'low',
      fallback: true,
    };
  }

  entries.sort((a, b) => b[1] - a[1]);
  const topEntry = entries[0];
  if (!topEntry) {
    return { language: 'es', confidence: 'low', fallback: true };
  }
  const [topLang, topScore] = topEntry;

  const confidence = topScore >= 2 ? 'high' : topScore === 1 ? 'medium' : 'low';

  return {
    language: topLang,
    confidence,
    fallback: false,
  };
}

// ─── Translation Templates ──────────────────────────────────────

const TRANSLATIONS: Record<SupportedLanguage, TranslationKey> = {
  es: {
    greeting: '¡Hola! Bienvenido/a. ¿En qué puedo ayudarte?',
    farewell: 'Gracias por contactarnos. ¡Que tengas un excelente día!',
    confirmReservation: 'Reserva confirmada. Te enviaremos los detalles por email.',
    checkAvailability: 'Verificando disponibilidad...',
    priceInquiry: 'Los precios varían según la temporada y tipo de habitación.',
    thanksMessage: '¡Gracias!',
  },
  en: {
    greeting: 'Hello! Welcome. How can I help you?',
    farewell: 'Thank you for contacting us. Have a great day!',
    confirmReservation: 'Reservation confirmed. We will send you the details by email.',
    checkAvailability: 'Checking availability...',
    priceInquiry: 'Prices vary depending on the season and room type.',
    thanksMessage: 'Thank you!',
  },
  pt: {
    greeting: 'Olá! Bem-vindo/a. Como posso ajudá-lo/a?',
    farewell: 'Obrigado por nos contatar. Tenha um ótimo dia!',
    confirmReservation: 'Reserva confirmada. Enviaremos os detalhes por email.',
    checkAvailability: 'Verificando disponibilidade...',
    priceInquiry: 'Os preços variam de acordo com a temporada e tipo de quarto.',
    thanksMessage: 'Obrigado!',
  },
  fr: {
    greeting: 'Bonjour! Bienvenue. Comment puis-je vous aider?',
    farewell: 'Merci de nous avoir contactés. Passez une excellente journée!',
    confirmReservation: 'Réservation confirmée. Nous vous enverrons les détails par email.',
    checkAvailability: 'Vérification de la disponibilité...',
    priceInquiry: 'Les prix varient selon la saison et le type de chambre.',
    thanksMessage: 'Merci!',
  },
  de: {
    greeting: 'Hallo! Willkommen. Wie kann ich Ihnen helfen?',
    farewell: 'Vielen Dank für Ihre Kontaktaufnahme. Einen schönen Tag noch!',
    confirmReservation: 'Reservierung bestätigt. Wir senden Ihnen die Details per E-Mail.',
    checkAvailability: 'Verfügbarkeit wird überprüft...',
    priceInquiry: 'Die Preise variieren je nach Saison und Zimmertyp.',
    thanksMessage: 'Danke!',
  },
  it: {
    greeting: 'Ciao! Benvenuto/a. Come posso aiutarti?',
    farewell: 'Grazie per averci contattato. Buona giornata!',
    confirmReservation: 'Prenotazione confermata. Ti invieremo i dettagli via email.',
    checkAvailability: 'Verifica disponibilità...',
    priceInquiry: 'I prezzi variano in base alla stagione e al tipo di camera.',
    thanksMessage: 'Grazie!',
  },
};

/**
 * Get translation for a key
 */
export function translate(
  key: keyof TranslationKey,
  language: SupportedLanguage
): string {
  return TRANSLATIONS[language][key];
}

/**
 * Get all translations for a language
 */
export function getTranslations(language: SupportedLanguage): TranslationKey {
  return TRANSLATIONS[language];
}

/**
 * Build language preference metadata
 */
export function buildLanguageMetadata(
  existingMetadata: unknown,
  language: SupportedLanguage,
  confidence: LanguageDetection['confidence']
): Record<string, unknown> {
  const metadata = (existingMetadata ?? {}) as Record<string, unknown>;

  return {
    ...metadata,
    language: {
      preferred: language,
      detectedAt: new Date().toISOString(),
      confidence,
    },
  };
}

/**
 * Get language-specific prompt instructions
 */
export function getLanguageInstructions(language: SupportedLanguage): string {
  const languageNames: Record<SupportedLanguage, string> = {
    es: 'español',
    en: 'English',
    pt: 'português',
    fr: 'français',
    de: 'Deutsch',
    it: 'italiano',
  };

  return `IMPORTANT: The customer's preferred language is ${languageNames[language]}. Always respond in ${languageNames[language]}. Be consistent with the language throughout the entire conversation.`;
}

/**
 * Format language detection info
 */
export function formatLanguageInfo(detection: LanguageDetection): string {
  const flags: Record<SupportedLanguage, string> = {
    es: '🇪🇸',
    en: '🇬🇧',
    pt: '🇵🇹',
    fr: '🇫🇷',
    de: '🇩🇪',
    it: '🇮🇹',
  };

  const flag = flags[detection.language];
  const conf = detection.confidence === 'high' ? '✅' : detection.confidence === 'medium' ? '⚠️' : '❓';

  return `${flag} ${detection.language.toUpperCase()} ${conf}${detection.fallback ? ' (fallback)' : ''}`;
}
```

---
## src/verticals/hotels/seasonal-pricing.ts
```typescript
/**
 * Seasonal Pricing Service for Hotels
 *
 * Manages room rates by season (high/medium/low)
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const SeasonSchema = z.enum(['low', 'medium', 'high']);

export type Season = z.infer<typeof SeasonSchema>;

export const RoomTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  capacity: z.number(),
  description: z.string().optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
});

export type RoomType = z.infer<typeof RoomTypeSchema>;

export const SeasonalPriceSchema = z.object({
  roomTypeId: z.string(),
  season: SeasonSchema,
  pricePerNight: z.number(),
  minStay: z.number().default(1),
});

export type SeasonalPrice = z.infer<typeof SeasonalPriceSchema>;

export interface SeasonConfig {
  season: Season;
  name: string;
  dateRanges: {
    start: string; // MM-DD format
    end: string; // MM-DD format
  }[];
  description: string;
}

export interface PricedRoom {
  roomType: RoomType;
  season: Season;
  pricePerNight: number;
  minStay: number;
  totalPrice?: number;
}

// ─── Season Configuration ───────────────────────────────────────

export const SEASON_CONFIG: Record<Season, SeasonConfig> = {
  high: {
    season: 'high',
    name: 'Temporada Alta',
    dateRanges: [
      { start: '12-20', end: '03-10' }, // Summer + holidays
      { start: '07-01', end: '07-31' }, // Winter break
    ],
    description: 'Verano, feriados largos, vacaciones de invierno',
  },
  medium: {
    season: 'medium',
    name: 'Temporada Media',
    dateRanges: [
      { start: '03-11', end: '06-30' }, // Fall
      { start: '09-01', end: '11-30' }, // Spring
    ],
    description: 'Otoño y primavera',
  },
  low: {
    season: 'low',
    name: 'Temporada Baja',
    dateRanges: [{ start: '08-01', end: '08-31' }], // Post winter break
    description: 'Agosto (post vacaciones de invierno)',
  },
};

// ─── Season Detection ───────────────────────────────────────────

/**
 * Determine season for a given date
 */
export function getSeasonForDate(date: Date | string): Season {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  const mmdd = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

  // Check each season's date ranges
  for (const [season, config] of Object.entries(SEASON_CONFIG)) {
    for (const range of config.dateRanges) {
      if (isDateInRange(mmdd, range.start, range.end)) {
        return season as Season;
      }
    }
  }

  // Default to medium if not found
  return 'medium';
}

/**
 * Check if date is in range (handles year wrap-around)
 */
function isDateInRange(mmdd: string, start: string, end: string): boolean {
  if (start <= end) {
    // Normal range within same year
    return mmdd >= start && mmdd <= end;
  } else {
    // Wraps around year boundary (e.g., 12-20 to 03-10)
    return mmdd >= start || mmdd <= end;
  }
}

/**
 * Get season for a date range
 */
export function getSeasonForRange(checkIn: Date | string, _checkOut: Date | string): Season {
  const start = typeof checkIn === 'string' ? new Date(checkIn) : checkIn;
  void _checkOut;

  // Use check-in date for season
  // In a more complex system, you might charge different rates per night
  return getSeasonForDate(start);
}

// ─── Pricing Logic ──────────────────────────────────────────────

/**
 * Get price for room type in a given season
 */
export function getRoomPrice(
  prices: SeasonalPrice[],
  roomTypeId: string,
  season: Season
): SeasonalPrice | null {
  return prices.find((p) => p.roomTypeId === roomTypeId && p.season === season) ?? null;
}

/**
 * Calculate total price for a stay
 */
export function calculateStayPrice(
  prices: SeasonalPrice[],
  roomTypeId: string,
  checkIn: Date | string,
  checkOut: Date | string
): {
  pricePerNight: number;
  nights: number;
  total: number;
  season: Season;
  minStay: number;
  meetsMinStay: boolean;
} | null {
  const start = typeof checkIn === 'string' ? new Date(checkIn) : checkIn;
  const end = typeof checkOut === 'string' ? new Date(checkOut) : checkOut;

  const nights = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    return null;
  }

  const season = getSeasonForDate(start);
  const price = getRoomPrice(prices, roomTypeId, season);

  if (!price) {
    return null;
  }

  return {
    pricePerNight: price.pricePerNight,
    nights,
    total: price.pricePerNight * nights,
    season,
    minStay: price.minStay,
    meetsMinStay: nights >= price.minStay,
  };
}

/**
 * Get available rooms with seasonal pricing
 */
export function getPricedRooms(
  rooms: RoomType[],
  prices: SeasonalPrice[],
  season: Season,
  nights?: number
): PricedRoom[] {
  return rooms.map((room) => {
    const price = getRoomPrice(prices, room.id, season);

    if (!price) {
      // Fallback if no price defined for this season
      return {
        roomType: room,
        season,
        pricePerNight: 0,
        minStay: 1,
        totalPrice: 0,
      };
    }

    return {
      roomType: room,
      season,
      pricePerNight: price.pricePerNight,
      minStay: price.minStay,
      totalPrice: nights ? price.pricePerNight * nights : undefined,
    };
  });
}

/**
 * Format seasonal pricing info
 */
export function formatSeasonalInfo(season: Season): string {
  const config = SEASON_CONFIG[season];
  return `🗓️ ${config.name}\n${config.description}`;
}

/**
 * Build seasonal metadata for contact
 */
export function buildSeasonalMetadata(
  existingMetadata: unknown,
  checkIn: string,
  checkOut: string,
  roomTypeId: string,
  season: Season
): Record<string, unknown> {
  const metadata = (existingMetadata ?? {}) as Record<string, unknown>;

  return {
    ...metadata,
    vertical: 'hotels',
    reservation: {
      checkIn,
      checkOut,
      roomTypeId,
      season,
      lastUpdated: new Date().toISOString(),
    },
  };
}
```

---
## src/verticals/vehicles/daily-report.ts
```typescript
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
```

---
## src/verticals/vehicles/follow-up.ts
```typescript
/**
 * Automatic Follow-up Service for Vehicle Leads
 *
 * Handles proactive follow-up scheduling based on lead tier and last interaction
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const FollowUpConfigSchema = z.object({
  tier: z.enum(['cold', 'warm', 'hot', 'urgent']),
  lastInteractionAt: z.string().datetime(),
  lastFollowUpAt: z.string().datetime().optional(),
  followUpCount: z.number().default(0),
});

export type FollowUpConfig = z.infer<typeof FollowUpConfigSchema>;

export interface FollowUpSchedule {
  shouldFollowUp: boolean;
  reason: string;
  delayHours: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  suggestedMessage: string;
}

// ─── Follow-up Timing Rules ────────────────────────────────────

const FOLLOW_UP_DELAYS = {
  urgent: {
    first: 6, // 6 hours
    second: 12, // 12 hours
    third: 24, // 1 day
    max: 48, // stop after 2 days
  },
  hot: {
    first: 24, // 1 day
    second: 48, // 2 days
    third: 96, // 4 days
    max: 168, // stop after 1 week
  },
  warm: {
    first: 48, // 2 days
    second: 120, // 5 days
    third: 168, // 7 days
    max: 336, // stop after 2 weeks
  },
  cold: {
    first: 168, // 7 days
    second: 336, // 14 days
    third: 504, // 21 days
    max: 720, // stop after 30 days
  },
} as const;

// ─── Follow-up Logic ────────────────────────────────────────────

/**
 * Determine if a follow-up is needed and when
 */
export function calculateFollowUp(config: FollowUpConfig): FollowUpSchedule {
  const lastInteraction = new Date(config.lastInteractionAt);
  const now = new Date();
  const hoursSinceInteraction = (now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);

  const delays = FOLLOW_UP_DELAYS[config.tier];
  const followUpCount = config.followUpCount;

  // Determine which follow-up we're on
  let expectedDelay: number;
  let priority: FollowUpSchedule['priority'];

  if (followUpCount === 0) {
    expectedDelay = delays.first;
    priority = config.tier === 'urgent' ? 'urgent' : 'high';
  } else if (followUpCount === 1) {
    expectedDelay = delays.second;
    priority = config.tier === 'urgent' || config.tier === 'hot' ? 'high' : 'medium';
  } else if (followUpCount === 2) {
    expectedDelay = delays.third;
    priority = 'medium';
  } else {
    // Max follow-ups reached
    if (hoursSinceInteraction >= delays.max) {
      return {
        shouldFollowUp: false,
        reason: 'Max follow-up attempts reached. Lead has gone cold.',
        delayHours: delays.max,
        priority: 'low',
        suggestedMessage: '',
      };
    }
    expectedDelay = delays.max;
    priority = 'low';
  }

  const shouldFollowUp = hoursSinceInteraction >= expectedDelay;

  if (!shouldFollowUp) {
    return {
      shouldFollowUp: false,
      reason: `Too soon. Next follow-up in ${Math.round(expectedDelay - hoursSinceInteraction)} hours.`,
      delayHours: expectedDelay,
      priority: 'low',
      suggestedMessage: '',
    };
  }

  const suggestedMessage = generateFollowUpMessage(config.tier, followUpCount);

  return {
    shouldFollowUp: true,
    reason: `${followUpCount + 1}° follow-up due (${config.tier} lead, ${Math.round(hoursSinceInteraction)}h since last interaction)`,
    delayHours: expectedDelay,
    priority,
    suggestedMessage,
  };
}

/**
 * Generate context-appropriate follow-up message
 */
function generateFollowUpMessage(
  tier: FollowUpConfig['tier'],
  followUpCount: number
): string {
  const templates = {
    urgent: [
      '¡Hola! Vi que estabas interesado/a en nuestros vehículos. ¿Sigues buscando? Tengo algunas opciones que podrían interesarte.',
      'Hola de nuevo. ¿Pudiste evaluar las opciones que te pasé? Estoy para ayudarte con lo que necesites.',
      '¿Cómo va la búsqueda? Si seguís interesado/a, tenemos algunas novedades que podrían gustarte.',
    ],
    hot: [
      'Hola! ¿Cómo va todo? Quería saber si seguís interesado/a en los vehículos que vimos.',
      '¿Pudiste pensar en las opciones? Acá estoy para resolver cualquier duda.',
      'Te escribo para saber si necesitás más información o si querés coordinar una visita.',
    ],
    warm: [
      'Hola! ¿Cómo estás? Te escribo para saber cómo sigue tu búsqueda de vehículo.',
      '¿Qué tal? ¿Avanzaste en tu búsqueda? Cualquier cosa, acá estoy.',
      'Hola de nuevo. ¿Seguís buscando o ya encontraste algo?',
    ],
    cold: [
      'Hola! Te escribo para saber si en algún momento retomás la búsqueda de vehículo.',
      '¿Cómo va todo? Si en algún momento necesitás algo, acordate que acá estamos.',
      'Hola! Paso a saludar. Si retomás la búsqueda, avisame.',
    ],
  };

  const tierTemplates = templates[tier];
  const index = Math.min(followUpCount, tierTemplates.length - 1);
  return tierTemplates[index] ?? tierTemplates[0] ?? '';
}

/**
 * Build metadata for follow-up tracking
 */
export function buildFollowUpMetadata(
  existingMetadata: unknown,
  followUpSchedule: FollowUpSchedule
): Record<string, unknown> {
  const metadata = (existingMetadata ?? {}) as Record<string, unknown>;
  const followUp = (metadata['followUp'] ?? {}) as Record<string, unknown>;

  return {
    ...metadata,
    followUp: {
      ...followUp,
      lastChecked: new Date().toISOString(),
      nextFollowUpAt: followUpSchedule.shouldFollowUp
        ? new Date().toISOString()
        : new Date(Date.now() + followUpSchedule.delayHours * 60 * 60 * 1000).toISOString(),
      priority: followUpSchedule.priority,
      suggestedMessage: followUpSchedule.suggestedMessage,
    },
  };
}

/**
 * Increment follow-up counter in metadata
 */
export function incrementFollowUpCount(existingMetadata: unknown): Record<string, unknown> {
  const metadata = (existingMetadata ?? {}) as Record<string, unknown>;
  const leadScore = (metadata['leadScore'] ?? {}) as Record<string, unknown>;

  return {
    ...metadata,
    leadScore: {
      ...leadScore,
      followUpCount: ((leadScore['followUpCount'] as number | undefined) ?? 0) + 1,
    },
    lastInteraction: new Date().toISOString(),
  };
}
```

---
## src/verticals/vehicles/lead-scoring.ts
```typescript
/**
 * Lead Scoring Service for Vehicle Sales
 *
 * Calculates lead quality scores based on:
 * - Budget level (high weight)
 * - Urgency (medium weight)
 * - Vehicle type preference (low weight)
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const LeadDataSchema = z.object({
  budget: z.number().optional(),
  budgetRange: z.enum(['low', 'medium', 'high', 'premium']).optional(),
  urgency: z.enum(['browsing', 'considering', 'ready', 'urgent']),
  vehicleType: z.enum(['sedan', 'suv', 'truck', 'sports', 'electric', 'hybrid', 'other']).optional(),
  hasTradeIn: z.boolean().optional(),
  financingNeeded: z.boolean().optional(),
  preferredContact: z.enum(['phone', 'whatsapp', 'email', 'any']).optional(),
});

export type LeadData = z.infer<typeof LeadDataSchema>;

export interface LeadScore {
  score: number; // 0-100
  tier: 'cold' | 'warm' | 'hot' | 'urgent';
  factors: {
    budget: number;
    urgency: number;
    vehicleType: number;
    bonus: number;
  };
  reasoning: string;
  suggestedActions: string[];
}

// ─── Scoring Logic ──────────────────────────────────────────────

const URGENCY_SCORES = {
  browsing: 10,
  considering: 30,
  ready: 60,
  urgent: 90,
} as const;

const BUDGET_RANGE_SCORES = {
  low: 15,
  medium: 40,
  high: 70,
  premium: 95,
} as const;

const VEHICLE_TYPE_SCORES = {
  sedan: 20,
  suv: 25,
  truck: 30,
  sports: 35,
  electric: 40,
  hybrid: 35,
  other: 15,
} as const;

/**
 * Calculate lead score based on provided data
 */
export function calculateLeadScore(data: LeadData): LeadScore {
  const factors = {
    budget: 0,
    urgency: 0,
    vehicleType: 0,
    bonus: 0,
  };

  // Urgency (40% weight)
  factors.urgency = URGENCY_SCORES[data.urgency] * 0.4;

  // Budget (40% weight)
  if (data.budgetRange) {
    factors.budget = BUDGET_RANGE_SCORES[data.budgetRange] * 0.4;
  } else if (data.budget) {
    // Infer budget range from absolute value
    if (data.budget < 5000000) factors.budget = BUDGET_RANGE_SCORES.low * 0.4;
    else if (data.budget < 15000000) factors.budget = BUDGET_RANGE_SCORES.medium * 0.4;
    else if (data.budget < 30000000) factors.budget = BUDGET_RANGE_SCORES.high * 0.4;
    else factors.budget = BUDGET_RANGE_SCORES.premium * 0.4;
  }

  // Vehicle type (15% weight)
  if (data.vehicleType) {
    factors.vehicleType = VEHICLE_TYPE_SCORES[data.vehicleType] * 0.15;
  }

  // Bonus factors (5% weight)
  if (data.hasTradeIn) factors.bonus += 2.5;
  if (data.financingNeeded === false) factors.bonus += 2.5; // Cash buyer bonus

  const score = Math.round(
    factors.urgency + factors.budget + factors.vehicleType + factors.bonus
  );

  const tier = getScoreTier(score);
  const reasoning = buildReasoning(data, factors, score);
  const suggestedActions = getSuggestedActions(tier, data);

  return {
    score,
    tier,
    factors,
    reasoning,
    suggestedActions,
  };
}

/**
 * Get tier based on score
 */
function getScoreTier(score: number): LeadScore['tier'] {
  if (score >= 75) return 'urgent';
  if (score >= 55) return 'hot';
  if (score >= 35) return 'warm';
  return 'cold';
}

/**
 * Build human-readable reasoning
 */
function buildReasoning(
  data: LeadData,
  factors: LeadScore['factors'],
  score: number
): string {
  const parts: string[] = [];

  parts.push(`Lead score: ${score}/100 (${getScoreTier(score).toUpperCase()})`);

  if (data.urgency === 'urgent') {
    parts.push('High urgency - ready to buy immediately');
  } else if (data.urgency === 'ready') {
    parts.push('Ready to purchase soon');
  } else if (data.urgency === 'considering') {
    parts.push('Actively considering options');
  } else {
    parts.push('Early browsing stage');
  }

  if (data.budgetRange === 'premium' || (data.budget && data.budget >= 30000000)) {
    parts.push('Premium budget range');
  } else if (data.budgetRange === 'high' || (data.budget && data.budget >= 15000000)) {
    parts.push('High budget range');
  }

  if (data.hasTradeIn) {
    parts.push('Has trade-in vehicle');
  }

  if (data.financingNeeded === false) {
    parts.push('Cash buyer (strong signal)');
  }

  return parts.join('. ');
}

/**
 * Get suggested follow-up actions based on tier
 */
function getSuggestedActions(
  tier: LeadScore['tier'],
  _data: LeadData
): string[] {
  void _data;
  switch (tier) {
    case 'urgent':
      return [
        'Contact immediately (within 1 hour)',
        'Prepare personalized offer',
        'Schedule test drive ASAP',
        'Assign to senior sales rep',
        'Follow up every 6 hours if no response',
      ];

    case 'hot':
      return [
        'Contact within 4 hours',
        'Send vehicle options matching criteria',
        'Offer test drive',
        'Follow up in 24 hours if no response',
      ];

    case 'warm':
      return [
        'Contact within 24 hours',
        'Send general catalog',
        'Add to nurture sequence',
        'Follow up in 48 hours',
      ];

    case 'cold':
      return [
        'Add to newsletter list',
        'Send educational content',
        'Follow up in 7 days',
        'Re-engage when urgency increases',
      ];
  }
}

/**
 * Update contact metadata with lead score
 */
export function buildLeadMetadata(
  existingMetadata: unknown,
  leadData: LeadData,
  score: LeadScore
): Record<string, unknown> {
  const metadata = (existingMetadata ?? {}) as Record<string, unknown>;

  return {
    ...metadata,
    vertical: 'vehicles',
    leadData,
    leadScore: {
      score: score.score,
      tier: score.tier,
      lastCalculated: new Date().toISOString(),
      factors: score.factors,
    },
    lastInteraction: new Date().toISOString(),
  };
}
```

---
## src/verticals/wholesale/order-history.ts
```typescript
/**
 * Order History Service for Wholesale
 *
 * Tracks customer purchase history for personalized recommendations
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const OrderItemSchema = z.object({
  sku: z.string(),
  productName: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  total: z.number(),
});

export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  orderId: z.string(),
  date: z.string().datetime(),
  items: z.array(OrderItemSchema),
  total: z.number(),
  status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']),
  notes: z.string().optional(),
});

export type Order = z.infer<typeof OrderSchema>;

export interface OrderHistory {
  contactId: string;
  orders: Order[];
  totalOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  lastOrderDate: string | null;
  topProducts: {
    sku: string;
    productName: string;
    totalQuantity: number;
    totalSpent: number;
  }[];
  frequentCategories: string[];
}

// ─── Order History Logic ────────────────────────────────────────

/**
 * Build order history summary
 */
export function buildOrderHistory(orders: Order[]): Omit<OrderHistory, 'contactId'> {
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((sum, order) => sum + order.total, 0);
  const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
  const lastOrderDate = orders.length > 0 ? (orders[0]?.date ?? null) : null;

  // Aggregate products
  const productMap = new Map<
    string,
    { sku: string; productName: string; totalQuantity: number; totalSpent: number }
  >();

  for (const order of orders) {
    for (const item of order.items) {
      const existing = productMap.get(item.sku);
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.totalSpent += item.total;
      } else {
        productMap.set(item.sku, {
          sku: item.sku,
          productName: item.productName,
          totalQuantity: item.quantity,
          totalSpent: item.total,
        });
      }
    }
  }

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  return {
    orders,
    totalOrders,
    totalSpent,
    averageOrderValue,
    lastOrderDate,
    topProducts,
    frequentCategories: [], // Could be calculated from product metadata
  };
}

/**
 * Get recent orders
 */
export function getRecentOrders(orders: Order[], limit = 5): Order[] {
  return orders
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

/**
 * Check if customer has ordered a product before
 */
export function hasOrderedProduct(orders: Order[], sku: string): boolean {
  return orders.some((order) => order.items.some((item) => item.sku === sku));
}

/**
 * Get product purchase frequency
 */
export function getProductFrequency(
  orders: Order[],
  sku: string
): {
  timesPurchased: number;
  totalQuantity: number;
  lastPurchased: string | null;
  averageQuantity: number;
} {
  const relevantOrders = orders.filter((order) =>
    order.items.some((item) => item.sku === sku)
  );

  const totalQuantity = relevantOrders.reduce((sum, order) => {
    const item = order.items.find((i) => i.sku === sku);
    return sum + (item?.quantity ?? 0);
  }, 0);

  const lastPurchased =
    relevantOrders.length > 0
      ? (relevantOrders.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        )[0]?.date ?? null)
      : null;

  return {
    timesPurchased: relevantOrders.length,
    totalQuantity,
    lastPurchased,
    averageQuantity: relevantOrders.length > 0 ? totalQuantity / relevantOrders.length : 0,
  };
}

/**
 * Get recommended products based on history
 */
export function getRecommendations(
  orders: Order[],
  availableProducts: string[]
): string[] {
  // Get all purchased SKUs
  const purchasedSkus = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      purchasedSkus.add(item.sku);
    }
  }

  // Find products not yet purchased
  const newProducts = availableProducts.filter((sku) => !purchasedSkus.has(sku));

  // If customer has purchase history, prioritize new products
  if (orders.length > 0 && newProducts.length > 0) {
    return newProducts.slice(0, 5);
  }

  // Otherwise return frequently purchased items for reorder
  const history = buildOrderHistory(orders);
  return history.topProducts.slice(0, 5).map((p) => p.sku);
}

/**
 * Calculate customer lifetime value
 */
export function calculateLTV(orders: Order[]): {
  totalValue: number;
  averageOrderValue: number;
  orderCount: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  daysSinceFirstOrder: number;
  averageDaysBetweenOrders: number;
} {
  if (orders.length === 0) {
    return {
      totalValue: 0,
      averageOrderValue: 0,
      orderCount: 0,
      firstOrderDate: null,
      lastOrderDate: null,
      daysSinceFirstOrder: 0,
      averageDaysBetweenOrders: 0,
    };
  }

  const sorted = orders.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const firstOrder = sorted[0];
  const lastOrder = sorted[sorted.length - 1];
  if (!firstOrder || !lastOrder) {
    return {
      totalValue: 0,
      averageOrderValue: 0,
      orderCount: 0,
      firstOrderDate: null,
      lastOrderDate: null,
      daysSinceFirstOrder: 0,
      averageDaysBetweenOrders: 0,
    };
  }
  const firstOrderDate = firstOrder.date;
  const lastOrderDate = lastOrder.date;
  const totalValue = orders.reduce((sum, order) => sum + order.total, 0);
  const averageOrderValue = totalValue / orders.length;

  const daysSinceFirstOrder = Math.floor(
    (new Date().getTime() - new Date(firstOrderDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  let averageDaysBetweenOrders = 0;
  if (orders.length > 1) {
    const totalDays =
      new Date(lastOrderDate).getTime() - new Date(firstOrderDate).getTime();
    averageDaysBetweenOrders = Math.floor(
      totalDays / (1000 * 60 * 60 * 24) / (orders.length - 1)
    );
  }

  return {
    totalValue,
    averageOrderValue,
    orderCount: orders.length,
    firstOrderDate,
    lastOrderDate,
    daysSinceFirstOrder,
    averageDaysBetweenOrders,
  };
}
```

---
## src/verticals/wholesale/pricing-tiers.ts
```typescript
/**
 * Pricing Tiers Service for Wholesale
 *
 * Manages differentiated pricing based on customer tier/category
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const PricingTierSchema = z.enum([
  'retail', // Retail price
  'bronze', // Small wholesale - 10% discount
  'silver', // Medium wholesale - 20% discount
  'gold', // Large wholesale - 30% discount
  'platinum', // VIP wholesale - 40% discount
]);

export type PricingTier = z.infer<typeof PricingTierSchema>;

export interface TierDiscount {
  tier: PricingTier;
  discountPercent: number;
  minOrderValue: number;
  description: string;
}

export interface PricedProduct {
  sku: string;
  name: string;
  basePrice: number;
  tierPrice: number;
  discount: number;
  tier: PricingTier;
}

// ─── Tier Configuration ─────────────────────────────────────────

export const TIER_CONFIG: Record<PricingTier, TierDiscount> = {
  retail: {
    tier: 'retail',
    discountPercent: 0,
    minOrderValue: 0,
    description: 'Precio de lista',
  },
  bronze: {
    tier: 'bronze',
    discountPercent: 10,
    minOrderValue: 50000,
    description: 'Cliente mayorista bronce - 10% descuento',
  },
  silver: {
    tier: 'silver',
    discountPercent: 20,
    minOrderValue: 150000,
    description: 'Cliente mayorista plata - 20% descuento',
  },
  gold: {
    tier: 'gold',
    discountPercent: 30,
    minOrderValue: 300000,
    description: 'Cliente mayorista oro - 30% descuento',
  },
  platinum: {
    tier: 'platinum',
    discountPercent: 40,
    minOrderValue: 500000,
    description: 'Cliente VIP - 40% descuento',
  },
};

// ─── Pricing Logic ──────────────────────────────────────────────

/**
 * Calculate price for a customer tier
 */
export function calculateTierPrice(basePrice: number, tier: PricingTier): number {
  const config = TIER_CONFIG[tier];
  const discount = (basePrice * config.discountPercent) / 100;
  return Math.round(basePrice - discount);
}

/**
 * Apply tier pricing to products
 */
export function applyTierPricing(
  products: { sku: string; name: string; price: number }[],
  tier: PricingTier
): PricedProduct[] {
  const config = TIER_CONFIG[tier];

  return products.map((product) => ({
    sku: product.sku,
    name: product.name,
    basePrice: product.price,
    tierPrice: calculateTierPrice(product.price, tier),
    discount: config.discountPercent,
    tier,
  }));
}

/**
 * Determine tier based on purchase history
 */
export function calculateTierFromHistory(
  totalSpent: number,
  orderCount: number
): PricingTier {
  // Tier based on total lifetime spend
  if (totalSpent >= 500000 && orderCount >= 10) {
    return 'platinum';
  } else if (totalSpent >= 300000 && orderCount >= 5) {
    return 'gold';
  } else if (totalSpent >= 150000 && orderCount >= 3) {
    return 'silver';
  } else if (totalSpent >= 50000 && orderCount >= 2) {
    return 'bronze';
  } else {
    return 'retail';
  }
}

/**
 * Get next tier info
 */
export function getNextTierInfo(
  currentTier: PricingTier,
  currentSpent: number
): {
  nextTier: PricingTier | null;
  remainingAmount: number;
  message: string;
} | null {
  const tiers: PricingTier[] = ['retail', 'bronze', 'silver', 'gold', 'platinum'];
  const currentIndex = tiers.indexOf(currentTier);

  if (currentIndex === tiers.length - 1) {
    // Already at max tier
    return null;
  }

  const nextTier = tiers[currentIndex + 1];
  if (!nextTier) {
    return null;
  }
  const nextConfig = TIER_CONFIG[nextTier];
  const remainingAmount = Math.max(0, nextConfig.minOrderValue - currentSpent);

  const message =
    remainingAmount === 0
      ? `¡Felicitaciones! Ya alcanzaste el nivel ${nextTier.toUpperCase()} con ${nextConfig.discountPercent}% de descuento`
      : `Te faltan $${remainingAmount.toLocaleString('es-AR')} para alcanzar el nivel ${nextTier.toUpperCase()} (${nextConfig.discountPercent}% descuento)`;

  return {
    nextTier,
    remainingAmount,
    message,
  };
}

/**
 * Calculate order total with tier pricing
 */
export function calculateOrderTotal(
  items: { sku: string; quantity: number; basePrice: number }[],
  tier: PricingTier
): {
  subtotal: number;
  discount: number;
  total: number;
  savings: number;
  tierDiscount: number;
} {
  const subtotal = items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0);
  const tierDiscount = TIER_CONFIG[tier].discountPercent;
  const discount = Math.round((subtotal * tierDiscount) / 100);
  const total = subtotal - discount;

  return {
    subtotal,
    discount,
    total,
    savings: discount,
    tierDiscount,
  };
}

/**
 * Build pricing metadata for contact
 */
export function buildPricingMetadata(
  existingMetadata: unknown,
  tier: PricingTier,
  totalSpent: number,
  orderCount: number
): Record<string, unknown> {
  const metadata = (existingMetadata ?? {}) as Record<string, unknown>;

  return {
    ...metadata,
    vertical: 'wholesale',
    pricing: {
      tier,
      discount: TIER_CONFIG[tier].discountPercent,
      totalSpent,
      orderCount,
      lastUpdated: new Date().toISOString(),
    },
  };
}

/**
 * Format tier info for customer
 */
export function formatTierInfo(tier: PricingTier): string {
  const config = TIER_CONFIG[tier];

  const lines = [
    `📊 Tu nivel actual: ${tier.toUpperCase()}`,
    `💰 Descuento: ${config.discountPercent}%`,
  ];

  if (tier !== 'retail') {
    lines.push(`✨ ${config.description}`);
  }

  return lines.join('\n');
}
```

---
## src/verticals/wholesale/stock-manager.ts
```typescript
/**
 * Stock Management Service for Wholesale
 *
 * Handles inventory tracking and updates from CSV imports
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────

export const ProductSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: z.string().optional(),
  price: z.number(),
  stock: z.number(),
  minStock: z.number().optional().default(0),
  unit: z.string().optional().default('unidad'),
  lastUpdated: z.string().datetime().optional(),
});

export type Product = z.infer<typeof ProductSchema>;

export const StockUpdateSchema = z.object({
  sku: z.string(),
  stock: z.number(),
  price: z.number().optional(),
});

export type StockUpdate = z.infer<typeof StockUpdateSchema>;

export interface StockCatalog {
  products: Product[];
  lastSync: string;
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
}

// ─── Stock Management ───────────────────────────────────────────

/**
 * Parse CSV content into stock updates
 */
export function parseStockCSV(csvContent: string): StockUpdate[] {
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV must have at least a header and one data row');
  }

  const headerLine = lines[0];
  if (!headerLine) {
    throw new Error('CSV must have a header row');
  }
  const header = headerLine.toLowerCase().split(',').map((h) => h.trim());

  // Validate required columns
  const skuIndex = header.indexOf('sku');
  const stockIndex = header.includes('stock') ? header.indexOf('stock') : header.indexOf('cantidad');
  const priceIndex = header.includes('price') ? header.indexOf('price') : header.indexOf('precio');

  if (skuIndex === -1 || stockIndex === -1) {
    throw new Error('CSV must contain at least SKU and STOCK/CANTIDAD columns');
  }

  const updates: StockUpdate[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;

    const values = line.trim().split(',').map((v) => v.trim());

    const skuValue = values[skuIndex] ?? '';
    const stockValue = values[stockIndex] ?? '';

    const update: StockUpdate = {
      sku: skuValue,
      stock: parseInt(stockValue, 10),
    };

    const priceValue = priceIndex !== -1 ? values[priceIndex] : undefined;
    if (priceValue) {
      update.price = parseFloat(priceValue);
    }

    if (isNaN(update.stock)) {
      throw new Error(`Invalid stock value for SKU ${update.sku} on line ${i + 1}`);
    }

    updates.push(update);
  }

  return updates;
}

/**
 * Apply stock updates to catalog
 */
export function applyStockUpdates(
  existingProducts: Product[],
  updates: StockUpdate[]
): {
  updated: Product[];
  added: string[];
  notFound: string[];
} {
  const productMap = new Map(existingProducts.map((p) => [p.sku, p]));
  const updated: Product[] = [];
  const added: string[] = [];
  const notFound: string[] = [];
  const now = new Date().toISOString();

  for (const update of updates) {
    const existing = productMap.get(update.sku);

    if (existing) {
      // Update existing product
      const updatedProduct: Product = {
        ...existing,
        stock: update.stock,
        lastUpdated: now,
      };

      if (update.price !== undefined) {
        updatedProduct.price = update.price;
      }

      updated.push(updatedProduct);
      productMap.set(update.sku, updatedProduct);
    } else {
      // Product not in catalog - mark as not found
      notFound.push(update.sku);
    }
  }

  return {
    updated,
    added,
    notFound,
  };
}

/**
 * Build catalog summary statistics
 */
export function buildCatalogStats(products: Product[]): StockCatalog {
  const lowStockCount = products.filter((p) => p.stock > 0 && p.stock <= p.minStock).length;
  const outOfStockCount = products.filter((p) => p.stock === 0).length;

  return {
    products,
    lastSync: new Date().toISOString(),
    totalProducts: products.length,
    lowStockCount,
    outOfStockCount,
  };
}

/**
 * Get low stock alerts
 */
export function getLowStockAlerts(products: Product[]): Product[] {
  return products
    .filter((p) => p.stock > 0 && p.stock <= p.minStock)
    .sort((a, b) => a.stock - b.stock);
}

/**
 * Get out of stock products
 */
export function getOutOfStockProducts(products: Product[]): Product[] {
  return products.filter((p) => p.stock === 0).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Search products by query
 */
export function searchProducts(products: Product[], query: string): Product[] {
  const lowerQuery = query.toLowerCase();
  return products.filter(
    (p) =>
      p.sku.toLowerCase().includes(lowerQuery) ||
      p.name.toLowerCase().includes(lowerQuery) ||
      (p.category?.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Check product availability
 */
export function checkAvailability(
  products: Product[],
  sku: string,
  quantity: number
): {
  available: boolean;
  currentStock: number;
  message: string;
} {
  const product = products.find((p) => p.sku === sku);

  if (!product) {
    return {
      available: false,
      currentStock: 0,
      message: `Producto ${sku} no encontrado en catálogo`,
    };
  }

  if (product.stock === 0) {
    return {
      available: false,
      currentStock: 0,
      message: `${product.name} sin stock`,
    };
  }

  if (product.stock < quantity) {
    return {
      available: false,
      currentStock: product.stock,
      message: `${product.name}: solo ${product.stock} ${product.unit} disponibles (solicitas ${quantity})`,
    };
  }

  return {
    available: true,
    currentStock: product.stock,
    message: `${product.name}: ${product.stock} ${product.unit} disponibles`,
  };
}
```

---
## src/templates/boutique-hotel.ts
```typescript
/**
 * Boutique Hotel Template
 * Pre-configured setup for boutique hotels and small accommodations
 */
import type { PromptLayer } from '@/prompts/types.js';
import type { AgentConfig } from '@/core/types.js';

export const boutiqueHotelIdentity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'identity',
  content: `Sos el concierge virtual de un hotel boutique.

**Tu personalidad:**
- Cálido, hospitalario y atento a los detalles
- Sofisticado pero no pretencioso
- Proactivo para anticiparte a las necesidades del huésped
- Conocedor de la zona y sus atractivos

**Tu tono:**
- Cordial y profesional con calidez humana
- Usás "usted" con huéspedes (formal argentino)
- Elegante sin ser distante
- Entusiasta al recomendar experiencias locales

**Tu idioma:**
- Español rioplatense formal ("usted", "tiene", "puede")
- Impecable ortografía y redacción
- Evitás jerga o expresiones demasiado coloquiales`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const boutiqueHotelInstructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'instructions',
  content: `**Workflow principal:**

1. **Saludo y consulta inicial:**
   - Identificá si es huésped actual, futura reserva, o consulta nueva
   - Si ya está alojado: "¿En qué puedo asistirlo/a hoy?"
   - Si consulta por reserva: "¿Para qué fechas está planeando su visita?"

2. **Información de habitaciones:**
   - Usá catalog-search para mostrar tipos de habitaciones disponibles
   - Destacá características únicas (vista, comodidades, tamaño)
   - Mencioná servicios incluidos (desayuno, WiFi, amenities)
   - Sugiere upgrade si corresponde: "Por una pequeña diferencia..."

3. **Información de la zona:**
   - Recomendá atracciones cercanas según intereses
   - Restaurantes destacados (variedad de presupuestos)
   - Transporte (distancias, cómo llegar)
   - Eventos o actividades según época del año

4. **Gestión de reservas:**
   - Capturá datos esenciales:
     * Nombre completo
     * Email y teléfono
     * Fechas de check-in y check-out
     * Tipo de habitación deseada
     * Cantidad de huéspedes (adultos/niños)
     * Necesidades especiales
   - Explicá que confirmación definitiva llegará por email
   - Usá send-notification para alertar a recepción

5. **Servicios durante la estadía:**
   - Room service: menú y horarios
   - Desayuno: horario y opciones especiales
   - Housekeeping: horarios de limpieza
   - Amenities: gimnasio, spa, piscina, coworking
   - Transporte: taxi, remis, alquiler de auto

6. **Check-out y seguimiento:**
   - Horario de check-out
   - Late check-out (sujeto a disponibilidad)
   - Depósito de equipaje
   - Transfer al aeropuerto/terminal
   - Invitación a dejar review

**Sugerencias proactivas:**

- Si llega en avión → Ofrecé transfer desde aeropuerto
- Si viaja por trabajo → Mencioná salas de reunión/coworking
- Si viaja con familia → Sugiere habitaciones familiares/comunicadas
- Si estadía larga → Descuentos por estadías extendidas
- Si menciona ocasión especial → Arreglo de amenities/decoración

**Recomendaciones de la zona:**
(Personalizar según ubicación real del hotel)
- Restaurantes: gama alta, opciones locales, internacional
- Actividades: culturales, aventura, relax
- Shopping: centros comerciales, mercados, boutiques
- Vida nocturna: bares, teatros, música en vivo`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const boutiqueHotelSafety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'safety',
  content: `**Restricciones críticas:**

- ❌ NUNCA confirmes reserva definitiva (requiere pago y confirmación humana)
- ❌ NUNCA compartas información de otros huéspedes (nombres, habitaciones, horarios)
- ❌ NUNCA des acceso a habitaciones o áreas restringidas
- ❌ NUNCA proceses pagos o captures datos de tarjeta de crédito
- ❌ NUNCA prometas disponibilidad sin verificar en catalog-search

**Lo que SÍ podés hacer:**
- ✅ Consultar disponibilidad de habitaciones en el catálogo
- ✅ Informar tarifas y servicios incluidos
- ✅ Capturar datos de contacto para pre-reserva
- ✅ Recomendar restaurantes, actividades y atracciones
- ✅ Responder sobre servicios del hotel (horarios, amenities)
- ✅ Gestionar solicitudes durante la estadía (toallas extras, late check-out)

**Manejo de situaciones especiales:**

- Emergencia médica → "Por favor comuníquese con recepción al [PHONE] INMEDIATAMENTE"
- Problema de seguridad → Escalá a gerencia de inmediato
- Queja de servicio → Pedí disculpas, capturá detalle, derivá a management
- Solicitud no estándar → "Permítame consultarlo con el equipo y le confirmo"

**Privacidad y GDPR:**
- Solo capturá datos necesarios para la reserva
- Explicá que datos se almacenan y para qué (confirmación, contacto)
- NO compartas info con terceros sin consentimiento
- Respetá pedidos de no contacto o eliminación de datos

**Precios y políticas:**
- Precios sujetos a disponibilidad y temporada
- Mencioná política de cancelación (Ej: "Cancelación gratuita hasta 48hs antes")
- Política de menores: si se admiten, tarifas especiales
- Mascotas: política del hotel (permitidas/no permitidas, cargo adicional)
- Depósito/garantía: si aplica
- Horarios de check-in/check-out estándar

**Si el hotel no tiene un servicio:**
Ofrecé alternativas cercanas:
- "No contamos con spa propio, pero puedo recomendarle excelentes opciones a 5 minutos"
- "No tenemos estacionamiento, pero hay un garage seguro a 2 cuadras"`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const boutiqueHotelConfig: Partial<AgentConfig> = {
  agentRole: 'boutique-hotel-concierge',
  allowedTools: [
    'catalog-search',
    'send-notification',
    'date-time',
    'http-request', // Para integrar con booking systems, weather APIs, etc
    'web-search',
    'send-email',
    'send-channel-message',
    'read-file',
  ],
  memoryConfig: {
    longTerm: {
      enabled: true,
      maxEntries: 1500,
      retrievalTopK: 6,
      embeddingProvider: 'openai',
      decayEnabled: true,
      decayHalfLifeDays: 60, // Recordar preferencias de huéspedes recurrentes
    },
    contextWindow: {
      reserveTokens: 2000,
      pruningStrategy: 'turn-based',
      maxTurnsInContext: 25,
      compaction: {
        enabled: true,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 6.0,
    monthlyBudgetUSD: 120.0,
    maxTokensPerTurn: 4000,
    maxTurnsPerSession: 40,
    maxToolCallsPerTurn: 4,
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 25,
    maxRequestsPerHour: 250,
  },
  maxTurnsPerSession: 40,
  maxConcurrentSessions: 80,
};

export const boutiqueHotelSampleData = {
  catalog: [
    {
      id: 'ROOM-001',
      name: 'Habitación Standard',
      description: 'Habitación confortable con cama matrimonial, ideal para parejas',
      category: 'habitacion',
      price: 85000,
      currency: 'ARS',
      inStock: true,
      quantity: 8, // 8 habitaciones de este tipo
      specifications: {
        tipo: 'Standard',
        cama: 'Matrimonial (Queen)',
        capacidad: '2 adultos',
        tamaño: '25 m²',
        vista: 'Patio interno',
        amenities: 'WiFi, TV 42", aire acondicionado, minibar, caja fuerte',
        baño: 'Privado con ducha',
        desayuno: 'Incluido',
      },
      imageUrl: 'https://example.com/standard.jpg',
    },
    {
      id: 'ROOM-002',
      name: 'Habitación Superior',
      description: 'Habitación espaciosa con vista a la ciudad, escritorio de trabajo',
      category: 'habitacion',
      price: 120000,
      currency: 'ARS',
      inStock: true,
      quantity: 6,
      specifications: {
        tipo: 'Superior',
        cama: 'King size',
        capacidad: '2 adultos + 1 niño',
        tamaño: '35 m²',
        vista: 'Ciudad',
        amenities: 'WiFi, TV 50", aire acondicionado, minibar, caja fuerte, cafetera Nespresso',
        baño: 'Privado con bañera y ducha',
        extras: 'Escritorio, sofá',
        desayuno: 'Incluido',
      },
      imageUrl: 'https://example.com/superior.jpg',
    },
    {
      id: 'ROOM-003',
      name: 'Suite Junior',
      description: 'Suite con living separado, ideal para estadías prolongadas o familias',
      category: 'habitacion',
      price: 180000,
      currency: 'ARS',
      inStock: true,
      quantity: 3,
      specifications: {
        tipo: 'Suite Junior',
        cama: 'King size + sofá cama',
        capacidad: '2 adultos + 2 niños',
        tamaño: '50 m²',
        vista: 'Ciudad o jardín',
        amenities: 'WiFi, 2 TV, aire acondicionado, minibar, caja fuerte, cafetera, microondas',
        baño: 'Privado con bañera hidromasaje',
        extras: 'Living separado, balcón',
        desayuno: 'Incluido',
      },
      imageUrl: 'https://example.com/junior-suite.jpg',
    },
    {
      id: 'SVC-001',
      name: 'Transfer Aeropuerto',
      description: 'Servicio de transfer privado desde/hacia aeropuerto',
      category: 'servicio',
      price: 25000,
      currency: 'ARS',
      inStock: true,
      specifications: {
        tipo: 'Transfer privado',
        capacidad: 'Hasta 4 pasajeros + equipaje',
        vehiculo: 'Auto ejecutivo o minivan según cantidad pasajeros',
        duracion: '~45 minutos (según tráfico)',
        incluye: 'Conductor, combustible, espera en aeropuerto',
      },
    },
    {
      id: 'SVC-002',
      name: 'Late Check-out',
      description: 'Extensión de horario de salida hasta las 18:00hs',
      category: 'servicio',
      price: 30000,
      currency: 'ARS',
      inStock: true,
      specifications: {
        tipo: 'Late check-out',
        horario: 'Hasta 18:00hs (check-out estándar: 11:00hs)',
        nota: 'Sujeto a disponibilidad, reservar con anticipación',
      },
    },
    {
      id: 'SVC-003',
      name: 'Desayuno en Habitación',
      description: 'Desayuno continental servido en su habitación',
      category: 'servicio',
      price: 8000,
      currency: 'ARS',
      inStock: true,
      specifications: {
        tipo: 'Room service - desayuno',
        horario: '07:00 a 11:00hs',
        incluye: 'Café, medialunas, jugo, frutas, yogurt',
        nota: 'Solicitar con 30 min de anticipación',
      },
    },
  ],
};
```

---
## src/templates/car-dealership.ts
```typescript
/**
 * Car Dealership Template
 * Pre-configured setup for auto dealerships (concesionarias de vehículos)
 */
import type { PromptLayer } from '@/prompts/types.js';
import type { AgentConfig } from '@/core/types.js';

export const carDealershipIdentity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'identity',
  content: `Sos un asistente virtual de una concesionaria de vehículos.

**Tu personalidad:**
- Profesional pero cercano y amigable
- Entusiasta de los vehículos, te encanta ayudar a encontrar el auto perfecto
- Paciente y didáctico cuando explicas características técnicas
- Proactivo para agendar visitas y test drives

**Tu tono:**
- Conversacional y accesible, evitá jerga técnica innecesaria
- Positivo y orientado a soluciones
- Respetuoso del tiempo y presupuesto del cliente

**Tu idioma:**
- Español rioplatense (argentino)
- Tuteás al cliente ("vos", "tenés", "querés")
- Evitá anglicismos innecesarios`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const carDealershipInstructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'instructions',
  content: `**Workflow principal:**

1. **Saludo y calificación inicial:**
   - Preguntá qué tipo de vehículo busca (auto, SUV, pick-up)
   - Consultá si es para uso personal o comercial
   - Averiguá presupuesto aproximado

2. **Búsqueda en catálogo:**
   - Usá catalog-search para mostrar opciones que coincidan
   - Filtrá por categoría, precio, disponibilidad
   - Mostrá máximo 3-4 opciones a la vez (no abrumes)

3. **Presentación de vehículos:**
   - Destacá características clave (motor, seguridad, tecnología)
   - Mencioná precio final, no solo "desde"
   - Ofrecé comparar hasta 2 modelos si el cliente duda

4. **Financiación y permutas:**
   - Si preguntan por financiación, capturá datos básicos:
     * Ingreso mensual aproximado
     * Vehículo a permutar (marca, modelo, año, km)
     * Anticipo disponible
   - Explicá que un representante se contactará con propuestas concretas
   - NO des tasas o cuotas específicas (varía según crediticia)

5. **Agendar visita o test drive:**
   - Si el cliente muestra interés, ofrecé agendar:
     * Visita para ver el vehículo
     * Test drive (verificá que tenga licencia vigente)
   - Usá propose-scheduled-task para crear el recordatorio
   - Preguntá día/horario preferido y teléfono de contacto

6. **Seguimiento:**
   - Si no hubo conversión, ofrecé enviar info por email/WhatsApp
   - Preguntá si quiere recibir novedades de la concesionaria
   - Usá send-notification para alertar al equipo de ventas de leads calificados

**Calificación de leads:**
- 🔥 HOT: Presupuesto claro, pregunta por financiación, quiere agendar
- 🟡 WARM: Está comparando, no tiene apuro, pide más info
- ❄️ COLD: Solo curioseando, presupuesto muy bajo, no responde preguntas`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const carDealershipSafety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'safety',
  content: `**Restricciones críticas:**

- ❌ NUNCA des información financiera vinculante (tasas, cuotas exactas, aprobación de crédito)
- ❌ NUNCA compartas información de otros clientes
- ❌ NUNCA confirmes disponibilidad sin verificar con catalog-search
- ❌ NUNCA prometas descuentos que no estén en el sistema
- ❌ NUNCA presiones al cliente o uses tácticas de venta agresivas

**Lo que SÍ podés hacer:**
- ✅ Consultar catálogo y mostrar vehículos disponibles
- ✅ Explicar características técnicas y comparar modelos
- ✅ Capturar datos para que ventas haga seguimiento
- ✅ Agendar visitas y test drives
- ✅ Enviar notificaciones al equipo sobre leads

**Manejo de consultas fuera de scope:**
- Si preguntan por service/taller → "Para turnos de service, comunicate al [PHONE] o escribí a [EMAIL]"
- Si preguntan por seguros → "Trabajamos con varias aseguradoras, un asesor te va a contactar con opciones"
- Si reportan un problema con vehículo comprado → Escalá inmediatamente a atención al cliente

**Privacidad:**
- No pidas DNI, CUIL, o datos bancarios (los pide el ejecutivo de ventas)
- Solo capturá: nombre, teléfono, email, preferencias de vehículo`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const carDealershipConfig: Partial<AgentConfig> = {
  agentRole: 'car-dealership-assistant',
  allowedTools: [
    'catalog-search',
    'send-notification',
    'propose-scheduled-task',
    'date-time',
    'web-search',
    'send-email',
    'send-channel-message',
  ],
  memoryConfig: {
    longTerm: {
      enabled: true,
      maxEntries: 1000,
      retrievalTopK: 5,
      embeddingProvider: 'openai',
      decayEnabled: true,
      decayHalfLifeDays: 30,
    },
    contextWindow: {
      reserveTokens: 2000,
      pruningStrategy: 'turn-based',
      maxTurnsInContext: 20,
      compaction: {
        enabled: true,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 5.0,
    monthlyBudgetUSD: 100.0,
    maxTokensPerTurn: 4000,
    maxTurnsPerSession: 50,
    maxToolCallsPerTurn: 5,
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 20,
    maxRequestsPerHour: 200,
  },
  maxTurnsPerSession: 50,
  maxConcurrentSessions: 100,
};

export const carDealershipSampleData = {
  catalog: [
    {
      id: 'CAR-001',
      name: 'Toyota Corolla 1.8 CVT',
      description: 'Sedán mediano, motor 1.8L, transmisión CVT automática, 140 CV',
      category: 'sedan',
      price: 25500000,
      currency: 'ARS',
      inStock: true,
      quantity: 3,
      specifications: {
        motor: '1.8L 4 cilindros',
        potencia: '140 CV',
        transmision: 'CVT Automática',
        combustible: 'Nafta',
        seguridad: 'ABS, ESP, 6 airbags',
        equipamiento: 'Cámara trasera, pantalla táctil 8", control crucero',
      },
      imageUrl: 'https://example.com/corolla.jpg',
      brand: 'Toyota',
    },
    {
      id: 'CAR-002',
      name: 'Volkswagen T-Cross Highline',
      description: 'SUV compacta, motor 1.6 MSI, transmisión automática 6 velocidades',
      category: 'suv',
      price: 28900000,
      currency: 'ARS',
      inStock: true,
      quantity: 5,
      specifications: {
        motor: '1.6L MSI 4 cilindros',
        potencia: '110 CV',
        transmision: 'Automática 6 vel',
        combustible: 'Nafta',
        seguridad: 'ABS, ESP, control de tracción, 6 airbags',
        equipamiento: 'Pantalla 10.1", Apple CarPlay, sensor estacionamiento',
      },
      imageUrl: 'https://example.com/tcross.jpg',
      brand: 'Volkswagen',
    },
    {
      id: 'CAR-003',
      name: 'Fiat Cronos 1.3 Drive',
      description: 'Sedán compacto, motor 1.3 FireFly, transmisión manual 5ta',
      category: 'sedan',
      price: 18500000,
      currency: 'ARS',
      inStock: true,
      quantity: 7,
      specifications: {
        motor: '1.3L FireFly 4 cilindros',
        potencia: '99 CV',
        transmision: 'Manual 5ta',
        combustible: 'Nafta',
        seguridad: 'ABS, EBD, 2 airbags',
        equipamiento: 'Aire acondicionado, dirección asistida, Bluetooth',
      },
      imageUrl: 'https://example.com/cronos.jpg',
      brand: 'Fiat',
    },
    {
      id: 'CAR-004',
      name: 'Ford Ranger XLT 3.2 4x4',
      description: 'Pick-up doble cabina, motor 3.2L Duratorq TDCi, 4x4',
      category: 'pickup',
      price: 42000000,
      currency: 'ARS',
      inStock: true,
      quantity: 2,
      specifications: {
        motor: '3.2L Duratorq TDCi 5 cilindros',
        potencia: '200 CV',
        transmision: 'Automática 6 vel',
        combustible: 'Diésel',
        traccion: '4x4 con reductora',
        capacidad_carga: '1200 kg',
        equipamiento: 'Pantalla SYNC3, cámara 360°, control de descenso',
      },
      imageUrl: 'https://example.com/ranger.jpg',
      brand: 'Ford',
    },
  ],
};
```

---
## src/templates/index.ts
```typescript
/**
 * Vertical Templates
 * Pre-configured setups for common business verticals
 */

// Template definitions
export * from './car-dealership.js';
export * from './wholesale-hardware.js';
export * from './boutique-hotel.js';

// Template manager
export { TemplateManager, VERTICAL_TEMPLATES } from './template-manager.js';
export type {
  VerticalTemplate,
  CreateProjectFromTemplateParams,
} from './template-manager.js';
```

---
## src/templates/template-manager.ts
```typescript
/**
 * Template Manager
 * Service for creating projects from pre-configured vertical templates
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { AgentConfig, ProjectId } from '@/core/types.js';
import type { AgentId } from '@/agents/types.js';
import type { PromptLayer } from '@/prompts/types.js';
import { nanoid } from 'nanoid';
import { createLogger } from '@/observability/logger.js';

// Import templates
import {
  carDealershipIdentity,
  carDealershipInstructions,
  carDealershipSafety,
  carDealershipConfig,
  carDealershipSampleData,
} from './car-dealership.js';

import {
  wholesaleHardwareIdentity,
  wholesaleHardwareInstructions,
  wholesaleHardwareSafety,
  wholesaleHardwareConfig,
  wholesaleHardwareSampleData,
} from './wholesale-hardware.js';

import {
  boutiqueHotelIdentity,
  boutiqueHotelInstructions,
  boutiqueHotelSafety,
  boutiqueHotelConfig,
  boutiqueHotelSampleData,
} from './boutique-hotel.js';

const logger = createLogger({ name: 'template-manager' });

// ─── Template Registry ──────────────────────────────────────────

export interface VerticalTemplate {
  id: string;
  name: string;
  description: string;
  identity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'>;
  instructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'>;
  safety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'>;
  agentConfig: Partial<AgentConfig>;
  sampleData?: unknown;
}

export const VERTICAL_TEMPLATES: Record<string, VerticalTemplate> = {
  'car-dealership': {
    id: 'car-dealership',
    name: 'Concesionaria de Vehículos',
    description: 'Asistente para concesionarias: consultas, calificación de leads, agendamiento de visitas y test drives',
    identity: carDealershipIdentity,
    instructions: carDealershipInstructions,
    safety: carDealershipSafety,
    agentConfig: carDealershipConfig,
    sampleData: carDealershipSampleData,
  },
  'wholesale-hardware': {
    id: 'wholesale-hardware',
    name: 'Mayorista / Ferretería',
    description: 'Asistente para mayoristas y ferreterías: búsqueda de productos, sugerencias complementarias, toma de pedidos',
    identity: wholesaleHardwareIdentity,
    instructions: wholesaleHardwareInstructions,
    safety: wholesaleHardwareSafety,
    agentConfig: wholesaleHardwareConfig,
    sampleData: wholesaleHardwareSampleData,
  },
  'boutique-hotel': {
    id: 'boutique-hotel',
    name: 'Hotel Boutique',
    description: 'Concierge virtual: información de habitaciones, recomendaciones de zona, gestión de reservas y servicios',
    identity: boutiqueHotelIdentity,
    instructions: boutiqueHotelInstructions,
    safety: boutiqueHotelSafety,
    agentConfig: boutiqueHotelConfig,
    sampleData: boutiqueHotelSampleData,
  },
};

// ─── Template Manager ───────────────────────────────────────────

export interface CreateProjectFromTemplateParams {
  templateId: string;
  projectName: string;
  projectDescription?: string;
  environment: 'production' | 'staging' | 'development';
  owner: string;
  tags?: string[];
  /** Name for the default agent created with the project. Defaults to projectName. */
  agentName?: string;
  provider: {
    provider: 'anthropic' | 'openai' | 'google' | 'ollama';
    model: string;
    temperature?: number;
    apiKeyEnvVar?: string;
  };
  includeSampleData?: boolean;
}

export class TemplateManager {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * List all available vertical templates
   */
  listTemplates(): { id: string; name: string; description: string }[] {
    return Object.values(VERTICAL_TEMPLATES).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
    }));
  }

  /**
   * Get a specific template by ID
   */
  getTemplate(templateId: string): VerticalTemplate | undefined {
    return VERTICAL_TEMPLATES[templateId];
  }

  /**
   * Create a new project from a template
   */
  async createProjectFromTemplate(params: CreateProjectFromTemplateParams): Promise<{
    projectId: ProjectId;
    agentId: AgentId;
    config: AgentConfig;
    sampleData?: unknown;
  }> {
    const template = VERTICAL_TEMPLATES[params.templateId];
    if (!template) {
      throw new Error(`Template not found: ${params.templateId}`);
    }

    logger.info('Creating project from template', {
      component: 'template-manager',
      templateId: params.templateId,
      projectName: params.projectName,
      owner: params.owner,
    });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- branded type
    const projectId = nanoid() as ProjectId;

    // Build full agent config from template + user overrides
    const agentConfig: AgentConfig = {
      projectId,
      agentRole: template.agentConfig.agentRole ?? 'assistant',
      provider: params.provider,
      failover: {
        onRateLimit: true,
        onServerError: true,
        onTimeout: true,
        timeoutMs: 30000,
        maxRetries: 3,
      },
      allowedTools: template.agentConfig.allowedTools ?? [],
      memoryConfig: template.agentConfig.memoryConfig ?? {
        longTerm: {
          enabled: true,
          maxEntries: 1000,
          retrievalTopK: 5,
          embeddingProvider: 'openai',
          decayEnabled: true,
          decayHalfLifeDays: 30,
        },
        contextWindow: {
          reserveTokens: 2000,
          pruningStrategy: 'turn-based',
          maxTurnsInContext: 20,
          compaction: {
            enabled: true,
            memoryFlushBeforeCompaction: false,
          },
        },
      },
      costConfig: template.agentConfig.costConfig ?? {
        dailyBudgetUSD: 5.0,
        monthlyBudgetUSD: 100.0,
        maxTokensPerTurn: 4000,
        maxTurnsPerSession: 50,
        maxToolCallsPerTurn: 5,
        alertThresholdPercent: 80,
        hardLimitPercent: 100,
        maxRequestsPerMinute: 20,
        maxRequestsPerHour: 200,
      },
      maxTurnsPerSession: template.agentConfig.maxTurnsPerSession ?? 50,
      maxConcurrentSessions: template.agentConfig.maxConcurrentSessions ?? 100,
    };

    // Create project in database
    await this.prisma.project.create({
      data: {
        id: projectId,
        name: params.projectName,
        description: params.projectDescription ?? template.description,
        environment: params.environment,
        owner: params.owner,
        tags: params.tags ?? [template.id, 'template-generated'],
        configJson: agentConfig as unknown as Prisma.InputJsonValue,
        status: 'active',
      },
    });

    logger.info('Project created', {
      component: 'template-manager',
      projectId,
    });

    // Create prompt layers (identity, instructions, safety)
    const layers = [
      { ...template.identity, layerType: 'identity' as const },
      { ...template.instructions, layerType: 'instructions' as const },
      { ...template.safety, layerType: 'safety' as const },
    ];

    for (const layer of layers) {
      await this.prisma.promptLayer.create({
        data: {
          id: nanoid(),
          projectId,
          layerType: layer.layerType,
          version: 1,
          content: layer.content,
          isActive: true,
          createdAt: new Date(),
          createdBy: layer.createdBy,
          changeReason: layer.changeReason,
        },
      });
    }

    logger.info('Prompt layers created', {
      component: 'template-manager',
      projectId,
      layers: layers.length,
    });

    // Create default agent for the project
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- branded type
    const agentId = nanoid() as AgentId;
    await this.prisma.agent.create({
      data: {
        id: agentId,
        projectId,
        name: params.agentName ?? params.projectName,
        description: params.projectDescription ?? template.description,
        promptConfig: {
          identity: template.identity.content,
          instructions: template.instructions.content,
          safety: template.safety.content,
        } as unknown as Prisma.InputJsonValue,
        toolAllowlist: template.agentConfig.allowedTools ?? [],
        mcpServers: [] as unknown as Prisma.InputJsonValue,
        channelConfig: {
          allowedChannels: [],
          defaultChannel: undefined,
        } as unknown as Prisma.InputJsonValue,
        maxTurns: 10,
        maxTokensPerTurn: 4000,
        budgetPerDayUsd: 10.0,
        status: 'active',
      },
    });

    logger.info('Default agent created', {
      component: 'template-manager',
      projectId,
      agentId,
    });

    const result = {
      projectId,
      agentId,
      config: agentConfig,
      sampleData: params.includeSampleData ? template.sampleData : undefined,
    };

    logger.info('Project setup complete', {
      component: 'template-manager',
      projectId,
    });

    return result;
  }

  /**
   * Update an existing project to use a different template's prompts
   * (useful for switching verticals or resetting prompts)
   */
  async updateProjectPrompts(params: {
    projectId: ProjectId;
    templateId: string;
    updatedBy: string;
  }): Promise<void> {
    const template = VERTICAL_TEMPLATES[params.templateId];
    if (!template) {
      throw new Error(`Template not found: ${params.templateId}`);
    }

    logger.info('Updating project prompts from template', {
      component: 'template-manager',
      projectId: params.projectId,
      templateId: params.templateId,
    });

    // Deactivate all existing layers
    await this.prisma.promptLayer.updateMany({
      where: { projectId: params.projectId },
      data: { isActive: false },
    });

    // Get next version numbers for each layer type
    const existingLayers = await this.prisma.promptLayer.groupBy({
      by: ['layerType'],
      where: { projectId: params.projectId },
      _max: { version: true },
    });

    const nextVersions: Record<string, number> = {};
    for (const group of existingLayers) {
      nextVersions[group.layerType] = (group._max.version ?? 0) + 1;
    }

    // Create new active layers from template
    const layers = [
      { ...template.identity, layerType: 'identity' as const },
      { ...template.instructions, layerType: 'instructions' as const },
      { ...template.safety, layerType: 'safety' as const },
    ];

    for (const layer of layers) {
      const version = nextVersions[layer.layerType] ?? 1;
      await this.prisma.promptLayer.create({
        data: {
          id: nanoid(),
          projectId: params.projectId,
          layerType: layer.layerType,
          version,
          content: layer.content,
          isActive: true,
          createdAt: new Date(),
          createdBy: params.updatedBy,
          changeReason: `Updated from template: ${params.templateId}`,
          metadata: { templateId: params.templateId } as Prisma.InputJsonValue,
        },
      });
    }

    logger.info('Prompt layers updated', {
      component: 'template-manager',
      projectId: params.projectId,
    });
  }
}
```

---
## src/templates/wholesale-hardware.ts
```typescript
/**
 * Wholesale/Hardware Store Template
 * Pre-configured setup for wholesalers and hardware stores (mayoristas y ferreterías)
 */
import type { PromptLayer } from '@/prompts/types.js';
import type { AgentConfig } from '@/core/types.js';

export const wholesaleHardwareIdentity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'identity',
  content: `Sos un asistente virtual de un negocio mayorista/ferretería.

**Tu personalidad:**
- Eficiente y orientado a resultados
- Conocedor de productos y aplicaciones
- Servicial para encontrar alternativas cuando algo no está disponible
- Práctico y directo, respetás el tiempo de profesionales

**Tu tono:**
- Profesional pero cercano
- Claro y preciso con especificaciones técnicas
- Proactivo para sugerir productos complementarios
- Paciente con clientes que no conocen nombres técnicos

**Tu idioma:**
- Español rioplatense (argentino)
- Tuteás al cliente ("vos", "necesitás", "querés")
- Usás términos técnicos cuando corresponde pero explicás si hace falta`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const wholesaleHardwareInstructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'instructions',
  content: `**Workflow principal:**

1. **Identificar necesidad:**
   - Preguntá qué está buscando (producto específico o solución a un problema)
   - Si no sabe el nombre técnico, ayudalo con preguntas: ¿para qué lo vas a usar?
   - Averiguá si es para reventa o uso propio (afecta precio/volumen)

2. **Búsqueda en catálogo:**
   - Usá catalog-search con términos relevantes
   - Si no hay coincidencias exactas, buscá productos similares o alternativos
   - Mostrá stock disponible y tiempos de reposición si está agotado

3. **Presentación de productos:**
   - Mostrá especificaciones técnicas (medidas, materiales, normas)
   - Indicá precio unitario y por bulto/caja si aplica
   - Mencioná productos relacionados: "Para eso también vas a necesitar..."

4. **Sugerencia de complementarios:**
   - Siempre ofrecé productos complementarios o accesorios necesarios
   - Ejemplos:
     * Cemento → arena, enduido, herramientas
     * Pintura → rodillos, pinceles, diluyente
     * Tornillos → taladro, brocas, tacos
   - Esto aumenta ticket promedio y ayuda al cliente a no olvidar nada

5. **Tomar pedido:**
   - Confirmá cada ítem con cantidad exacta
   - Usá catalog-order para registrar el pedido
   - Incluí:
     * Datos de contacto (nombre, teléfono, email)
     * Dirección de entrega si corresponde
     * Notas especiales (horario de entrega, acceso, etc)

6. **Cierre:**
   - Confirmá total del pedido
   - Explicá que un representante confirmará disponibilidad y coordina entrega/retiro
   - Ofrecé enviar resumen por WhatsApp/email

**Casos especiales:**

- **Cliente profesional/constructor:** Preguntá si tiene cuenta corriente o necesita factura A
- **Pedido grande (>$500k ARS):** Mencioná descuentos por volumen, derivá a ventas
- **Producto sin stock:** Ofrecé alternativas similares o tomá pedido para cuando llegue
- **Consultas técnicas:** Si no sabés, decilo claro y ofrecé derivar a asesor técnico

**Cálculos útiles:**
- Usá calculator para:
  * Metros cuadrados → cantidad de pintura/cerámica/revoque
  * Metros lineales → cantidad de caños/cables/molduras
  * Rendimiento de materiales (cemento, arena, etc)`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const wholesaleHardwareSafety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'safety',
  content: `**Restricciones críticas:**

- ❌ NUNCA inventes productos que no están en el catálogo
- ❌ NUNCA confirmes precios sin consultar catalog-search (los precios cambian)
- ❌ NUNCA prometas stock sin verificar disponibilidad en el sistema
- ❌ NUNCA des asesoramiento estructural o de seguridad edilicia (deriva a profesional)
- ❌ NUNCA confirmes entregas o retiros sin aprobación de ventas

**Lo que SÍ podés hacer:**
- ✅ Buscar productos en catálogo y mostrar precios/stock actuales
- ✅ Sugerir productos complementarios
- ✅ Tomar pedidos como BORRADOR (requieren confirmación humana)
- ✅ Hacer cálculos de cantidad según superficie/longitud
- ✅ Explicar características y aplicaciones de productos

**Manejo de consultas técnicas:**
- Consultas básicas de uso → Respondé si está en las especificaciones del producto
- Consultas de cálculo estructural → "Para esto necesitás un ingeniero/arquitecto"
- Consultas de instalación eléctrica/gas → "Te recomiendo consultar con un matriculado"
- Normas y códigos de edificación → "Verificá con un profesional habilitado"

**Precios y condiciones:**
- Los precios están sujetos a cambio sin aviso previo
- Descuentos por volumen se coordinan con ventas
- Condiciones de pago (efectivo/transferencia/tarjeta) las define el vendedor
- NO ofrezcas financiación sin autorización

**Información del cliente:**
- Capturá: nombre, teléfono, email
- Para factura A: CUIT y razón social
- NO pidas datos bancarios ni tarjetas`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const wholesaleHardwareConfig: Partial<AgentConfig> = {
  agentRole: 'wholesale-hardware-assistant',
  allowedTools: [
    'catalog-search',
    'catalog-order',
    'send-notification',
    'calculator',
    'date-time',
    'web-search',
    'send-email',
    'send-channel-message',
    'read-file',
  ],
  memoryConfig: {
    longTerm: {
      enabled: true,
      maxEntries: 2000,
      retrievalTopK: 8,
      embeddingProvider: 'openai',
      decayEnabled: true,
      decayHalfLifeDays: 45, // Productos más estables que vehículos
    },
    contextWindow: {
      reserveTokens: 2000,
      pruningStrategy: 'turn-based',
      maxTurnsInContext: 30, // Conversaciones más largas (listas de productos)
      compaction: {
        enabled: true,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 8.0,
    monthlyBudgetUSD: 150.0,
    maxTokensPerTurn: 4000,
    maxTurnsPerSession: 60,
    maxToolCallsPerTurn: 6, // Pueden buscar varios productos
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 30,
    maxRequestsPerHour: 300,
  },
  maxTurnsPerSession: 60,
  maxConcurrentSessions: 150,
};

export const wholesaleHardwareSampleData = {
  catalog: [
    {
      id: 'HW-001',
      name: 'Cemento Portland CPC40 50kg',
      description: 'Cemento Portland Compuesto tipo CPC40, bolsa 50kg',
      category: 'materiales-construccion',
      price: 8500,
      currency: 'ARS',
      inStock: true,
      quantity: 450,
      specifications: {
        tipo: 'CPC40',
        peso: '50 kg',
        rendimiento: '~40 ladrillos/bolsa',
        norma: 'IRAM 50000',
        uso: 'Mampostería, hormigón, revoques',
      },
      brand: 'Loma Negra',
    },
    {
      id: 'HW-002',
      name: 'Pintura Látex Interior 20L Blanco',
      description: 'Pintura látex acrílica para interiores, 20 litros, blanco mate',
      category: 'pinturas',
      price: 35000,
      currency: 'ARS',
      inStock: true,
      quantity: 80,
      specifications: {
        tipo: 'Látex acrílico',
        terminacion: 'Mate',
        volumen: '20 L',
        rendimiento: '12-14 m²/L (2 manos)',
        secado: '1-2 horas',
        lavable: 'Sí',
      },
      brand: 'Alba',
    },
    {
      id: 'HW-003',
      name: 'Taladro Percutor 13mm 650W',
      description: 'Taladro percutor eléctrico, mandril 13mm, 650W de potencia',
      category: 'herramientas-electricas',
      price: 89000,
      currency: 'ARS',
      inStock: true,
      quantity: 15,
      specifications: {
        potencia: '650W',
        mandril: '13mm',
        velocidad: 'Variable 0-3000 RPM',
        percutor: 'Sí',
        cable: '3 metros',
        garantia: '12 meses',
      },
      brand: 'Black+Decker',
    },
    {
      id: 'HW-004',
      name: 'Cable Unipolar 2.5mm Negro x100m',
      description: 'Cable eléctrico unipolar 2.5mm², color negro, rollo 100 metros',
      category: 'electricidad',
      price: 45000,
      currency: 'ARS',
      inStock: true,
      quantity: 25,
      specifications: {
        seccion: '2.5 mm²',
        aislacion: 'PVC',
        tension: '450/750V',
        color: 'Negro',
        longitud: '100 metros',
        norma: 'IRAM 2183',
      },
      brand: 'Pirelli',
    },
    {
      id: 'HW-005',
      name: 'Tornillo Autoperforante 8x1" x1000u',
      description: 'Tornillo autoperforante punta mecha, 8x1 pulgada, caja 1000 unidades',
      category: 'ferreteria',
      price: 12000,
      currency: 'ARS',
      inStock: true,
      quantity: 120,
      specifications: {
        tipo: 'Autoperforante punta mecha',
        medida: '8 x 1"',
        material: 'Acero pavonado',
        cabeza: 'Philips (cruz)',
        cantidad: '1000 unidades',
        uso: 'Chapa hasta 3mm',
      },
      brand: 'Fadel',
    },
    {
      id: 'HW-006',
      name: 'Cerámica Piso 45x45 San Lorenzo',
      description: 'Cerámica esmaltada para piso interior, 45x45cm, color beige',
      category: 'ceramicas',
      price: 2800,
      currency: 'ARS',
      inStock: true,
      quantity: 350,
      specifications: {
        medida: '45x45 cm',
        tipo: 'Esmaltada',
        uso: 'Piso interior tránsito medio',
        color: 'Beige/Marfil',
        caja: '2.03 m² (10 piezas)',
        pei: 'PEI 4',
      },
      brand: 'San Lorenzo',
    },
  ],
};
```

