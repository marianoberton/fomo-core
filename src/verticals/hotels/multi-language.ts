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
  const [topLang, topScore] = entries[0];

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
  const metadata = (existingMetadata as Record<string, unknown>) || {};

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
