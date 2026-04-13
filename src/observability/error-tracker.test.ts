/**
 * Tests for Error Pattern Tracker.
 */
import { describe, it, expect, vi } from 'vitest';
import { createErrorTracker } from './error-tracker.js';

describe('ErrorTracker', () => {
  it('tracks error counts per key', () => {
    const tracker = createErrorTracker();
    tracker.record('agent:a1', 'fail 1');
    tracker.record('agent:a1', 'fail 2');
    tracker.record('agent:a2', 'fail 1');

    expect(tracker.getCount('agent:a1')).toBe(2);
    expect(tracker.getCount('agent:a2')).toBe(1);
    expect(tracker.getCount('agent:a3')).toBe(0);
  });

  it('fires alert when threshold is exceeded', () => {
    const onAlert = vi.fn();
    const tracker = createErrorTracker({ threshold: 3, onAlert });

    tracker.record('ch:whatsapp', 'err 1');
    tracker.record('ch:whatsapp', 'err 2');
    expect(onAlert).not.toHaveBeenCalled();

    tracker.record('ch:whatsapp', 'err 3');
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'ch:whatsapp',
        count: 3,
        threshold: 3,
        lastError: 'err 3',
      }),
    );
  });

  it('respects alert cooldown', () => {
    const onAlert = vi.fn();
    const tracker = createErrorTracker({
      threshold: 2,
      onAlert,
      alertCooldownMs: 60_000,
    });

    // First alert
    tracker.record('key', 'e1');
    tracker.record('key', 'e2');
    expect(onAlert).toHaveBeenCalledTimes(1);

    // Still within cooldown — no second alert
    tracker.record('key', 'e3');
    tracker.record('key', 'e4');
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it('evicts entries outside the time window', async () => {
    const tracker = createErrorTracker({ windowMs: 50, threshold: 10 });

    tracker.record('key', 'old');

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(tracker.getCount('key')).toBe(0);
  });

  it('resets all data', () => {
    const tracker = createErrorTracker();
    tracker.record('key1', 'e');
    tracker.record('key2', 'e');
    tracker.reset();

    expect(tracker.getCount('key1')).toBe(0);
    expect(tracker.getCount('key2')).toBe(0);
  });

  it('does not crash if onAlert throws', () => {
    const tracker = createErrorTracker({
      threshold: 1,
      onAlert: () => { throw new Error('callback boom'); },
    });

    expect(() => tracker.record('key', 'err')).not.toThrow();
  });
});
