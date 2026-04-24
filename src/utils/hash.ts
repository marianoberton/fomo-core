/**
 * Lightweight hashing helpers backed by `node:crypto`.
 *
 * These are intended for cache-invalidation keys and similar non-cryptographic
 * fingerprinting use cases. Do NOT use for passwords or secrets.
 */
import { createHash } from 'node:crypto';

/** Compute the SHA-1 hex digest of the given input. */
export function sha1(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex');
}
