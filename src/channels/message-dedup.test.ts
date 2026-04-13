/**
 * Tests for Message Deduplicator.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInMemoryDedup } from './message-dedup.js';

describe('MessageDeduplicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for the first occurrence of a key', async () => {
    const dedup = createInMemoryDedup();
    expect(await dedup.isDuplicate('project-1:msg-abc')).toBe(false);
  });

  it('returns true for the second occurrence of the same key', async () => {
    const dedup = createInMemoryDedup();
    await dedup.isDuplicate('project-1:msg-abc');
    expect(await dedup.isDuplicate('project-1:msg-abc')).toBe(true);
  });

  it('treats different keys as independent', async () => {
    const dedup = createInMemoryDedup();
    await dedup.isDuplicate('project-1:msg-abc');
    expect(await dedup.isDuplicate('project-1:msg-def')).toBe(false);
  });

  it('evicts entries after TTL expires', async () => {
    const dedup = createInMemoryDedup({ ttlMs: 50 });
    await dedup.isDuplicate('project-1:msg-abc');

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Should be treated as new after expiry
    expect(await dedup.isDuplicate('project-1:msg-abc')).toBe(false);
  });

  it('evicts oldest entries when maxEntries exceeded', async () => {
    const dedup = createInMemoryDedup({ maxEntries: 3 });

    await dedup.isDuplicate('key-1');
    await dedup.isDuplicate('key-2');
    await dedup.isDuplicate('key-3');
    await dedup.isDuplicate('key-4'); // pushes key-1 out

    // key-1 should have been evicted (oldest)
    expect(await dedup.isDuplicate('key-1')).toBe(false);
    // key-3 and key-4 should still be there
    expect(await dedup.isDuplicate('key-3')).toBe(true);
    expect(await dedup.isDuplicate('key-4')).toBe(true);
  });

  it('logs a warning when a duplicate is detected', async () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const dedup = createInMemoryDedup({ logger: mockLogger });
    await dedup.isDuplicate('project-1:msg-abc');
    await dedup.isDuplicate('project-1:msg-abc');

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Duplicate message detected — skipping',
      expect.objectContaining({ dedupKey: 'project-1:msg-abc' }),
    );
  });
});
