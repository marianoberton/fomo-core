/**
 * Error Pattern Tracker — detects repeated failures and emits alerts.
 *
 * Tracks error counts per key (e.g. "agent:agent-123", "channel:whatsapp",
 * "provider:anthropic") within a sliding time window.  When the count
 * exceeds a configurable threshold, the alert callback fires.
 *
 * Designed for production use: lightweight, in-memory, no external deps.
 */
import { createLogger } from './logger.js';

const logger = createLogger({ name: 'error-tracker' });

// ─── Types ──────────────────────────────────────────────────────

export interface ErrorTrackerOptions {
  /** Time window in milliseconds for counting errors (default: 5 minutes). */
  windowMs?: number;
  /** Number of errors within the window to trigger an alert (default: 5). */
  threshold?: number;
  /** Callback fired when an error pattern is detected. */
  onAlert?: (alert: ErrorAlert) => void;
  /** Cooldown in milliseconds before the same key can trigger another alert (default: 15 minutes). */
  alertCooldownMs?: number;
}

export interface ErrorAlert {
  /** The key that triggered the alert (e.g. "agent:agent-123"). */
  key: string;
  /** Number of errors in the current window. */
  count: number;
  /** Threshold that was exceeded. */
  threshold: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** ISO timestamp of the alert. */
  timestamp: string;
  /** Most recent error message. */
  lastError: string;
}

export interface ErrorTracker {
  /** Record an error occurrence for a given key. */
  record(key: string, errorMessage: string): void;
  /** Get the current error count for a key within the window. */
  getCount(key: string): number;
  /** Reset all tracked errors. */
  reset(): void;
}

// ─── Implementation ─────────────────────────────────────────────

interface ErrorEntry {
  timestamp: number;
  message: string;
}

/**
 * Create an error pattern tracker.
 */
export function createErrorTracker(options?: ErrorTrackerOptions): ErrorTracker {
  const windowMs = options?.windowMs ?? 5 * 60 * 1000; // 5 minutes
  const threshold = options?.threshold ?? 5;
  const alertCooldownMs = options?.alertCooldownMs ?? 15 * 60 * 1000; // 15 minutes
  const onAlert = options?.onAlert;

  /** Sliding window of errors per key. */
  const errors = new Map<string, ErrorEntry[]>();
  /** Tracks when the last alert was fired per key (to enforce cooldown). */
  const lastAlertAt = new Map<string, number>();

  function evictExpired(key: string): ErrorEntry[] {
    const entries = errors.get(key);
    if (!entries) return [];

    const cutoff = Date.now() - windowMs;
    const active = entries.filter((e) => e.timestamp > cutoff);

    if (active.length === 0) {
      errors.delete(key);
    } else {
      errors.set(key, active);
    }

    return active;
  }

  return {
    record(key: string, errorMessage: string): void {
      const now = Date.now();

      // Append entry
      const entries = errors.get(key) ?? [];
      entries.push({ timestamp: now, message: errorMessage });
      errors.set(key, entries);

      // Evict old entries and get current count
      const active = evictExpired(key);

      if (active.length >= threshold) {
        // Check cooldown
        const lastAlert = lastAlertAt.get(key) ?? 0;
        if (now - lastAlert < alertCooldownMs) {
          return; // still in cooldown
        }

        lastAlertAt.set(key, now);

        const alert: ErrorAlert = {
          key,
          count: active.length,
          threshold,
          windowMs,
          timestamp: new Date(now).toISOString(),
          lastError: errorMessage,
        };

        logger.error('Error pattern detected', {
          component: 'error-tracker',
          alertKey: key,
          errorCount: active.length,
          threshold,
          windowMs,
          lastError: errorMessage,
        });

        if (onAlert) {
          try {
            onAlert(alert);
          } catch (err) {
            logger.error('onAlert callback failed', {
              component: 'error-tracker',
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    },

    getCount(key: string): number {
      return evictExpired(key).length;
    },

    reset(): void {
      errors.clear();
      lastAlertAt.clear();
    },
  };
}
