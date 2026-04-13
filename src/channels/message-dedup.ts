/**
 * Message Deduplicator — prevents duplicate processing of channel webhooks.
 *
 * WhatsApp, Telegram, and other platforms frequently retry webhook deliveries.
 * Without deduplication the system processes the same message multiple times,
 * resulting in duplicate agent responses sent to the customer.
 *
 * Uses an in-memory TTL map by default.  When Redis is available the caller
 * can supply a Redis-backed implementation for multi-instance deployments.
 */
import type { Logger } from '@/observability/logger.js';

// ─── Interface ──────────────────────────────────────────────────

export interface MessageDeduplicator {
  /**
   * Returns `true` if this message was already seen (i.e. is a duplicate).
   * If not, marks it as seen for future calls.
   */
  isDuplicate(key: string): Promise<boolean>;
}

// ─── In-Memory Implementation ───────────────────────────────────

export interface InMemoryDedupOptions {
  /** Time-to-live in milliseconds (default: 5 minutes). */
  ttlMs?: number;
  /** Max entries before oldest are evicted (default: 10 000). */
  maxEntries?: number;
  logger?: Logger;
}

/**
 * Create an in-memory deduplicator with automatic TTL eviction.
 *
 * Suitable for single-instance deployments.  For horizontal scaling
 * replace with a Redis SET NX EX implementation.
 */
export function createInMemoryDedup(options?: InMemoryDedupOptions): MessageDeduplicator {
  const ttlMs = options?.ttlMs ?? 5 * 60 * 1000; // 5 minutes
  const maxEntries = options?.maxEntries ?? 10_000;
  const logger = options?.logger;

  /** Map from dedup key → expiry timestamp (epoch ms). */
  const seen = new Map<string, number>();

  /** Remove expired entries. */
  function evictExpired(): void {
    const now = Date.now();
    for (const [k, expiresAt] of seen) {
      if (expiresAt <= now) {
        seen.delete(k);
      }
    }
  }

  /** Trim to maxEntries by evicting oldest (insertion-order). */
  function evictOverflow(): void {
    while (seen.size > maxEntries) {
      const oldest = seen.keys().next();
      if (!oldest.done) {
        seen.delete(oldest.value);
      }
    }
  }

  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async isDuplicate(key: string): Promise<boolean> {
      evictExpired();

      if (seen.has(key)) {
        logger?.warn('Duplicate message detected — skipping', {
          component: 'message-dedup',
          dedupKey: key,
        });
        return true;
      }

      seen.set(key, Date.now() + ttlMs);
      evictOverflow();
      return false;
    },
  };
}
