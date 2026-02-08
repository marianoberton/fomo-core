/**
 * InputSanitizer — scrubs user input before it enters the agent loop.
 * Defends against prompt injection, excessive length, and dangerous patterns.
 * This is a defense-in-depth measure — the LLM is NOT a security boundary.
 */
import { ValidationError } from '@/core/errors.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'input-sanitizer' });

export interface SanitizeOptions {
  /** Maximum input length in characters. Default: 100_000 */
  maxLength?: number;
  /** Whether to strip potential prompt injection patterns. Default: true */
  stripInjectionPatterns?: boolean;
}

/** Known prompt injection patterns to detect and flag. */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /<<\s*SYS\s*>>/i,
  /BEGININSTRUCTION/i,
  /\[SYSTEM\]/i,
];

export interface SanitizeResult {
  /** The sanitized input text. */
  sanitized: string;
  /** Whether any injection patterns were detected. */
  injectionDetected: boolean;
  /** The specific patterns that matched (for logging). */
  detectedPatterns: string[];
  /** Whether the input was truncated. */
  wasTruncated: boolean;
}

/**
 * Sanitize user input before it enters the agent loop.
 * Returns a SanitizeResult with the cleaned text and detection flags.
 */
export function sanitizeInput(
  input: string,
  options?: SanitizeOptions,
): SanitizeResult {
  const maxLength = options?.maxLength ?? 100_000;
  const stripInjection = options?.stripInjectionPatterns ?? true;

  let sanitized = input;
  let wasTruncated = false;
  const detectedPatterns: string[] = [];

  // Length check
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
    wasTruncated = true;
    logger.warn('Input truncated due to length', {
      component: 'input-sanitizer',
      originalLength: input.length,
      maxLength,
    });
  }

  // Strip null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Detect injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      detectedPatterns.push(pattern.source);
    }
  }

  const injectionDetected = detectedPatterns.length > 0;

  if (injectionDetected) {
    logger.warn('Potential prompt injection detected', {
      component: 'input-sanitizer',
      patterns: detectedPatterns,
    });

    if (stripInjection) {
      for (const pattern of INJECTION_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[FILTERED]');
      }
    }
  }

  return {
    sanitized,
    injectionDetected,
    detectedPatterns,
    wasTruncated,
  };
}

/**
 * Validate and sanitize input, throwing on empty input.
 * Convenience wrapper for API route handlers.
 */
export function validateUserInput(
  input: unknown,
  options?: SanitizeOptions,
): SanitizeResult {
  if (typeof input !== 'string') {
    throw new ValidationError('Input must be a string', { receivedType: typeof input });
  }

  if (input.trim().length === 0) {
    throw new ValidationError('Input must not be empty');
  }

  return sanitizeInput(input, options);
}
