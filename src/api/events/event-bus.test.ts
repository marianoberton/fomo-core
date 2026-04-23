/**
 * Unit tests for the project event bus.
 */
import { describe, it, expect, vi } from 'vitest';
import { createProjectEventBus } from './event-bus.js';
import type { ProjectEvent } from './event-bus.js';
import type { ProjectId, SessionId } from '@/core/types.js';

function makeEvent(projectId: string, text = 'hola'): ProjectEvent {
  return {
    kind: 'message.inbound',
    projectId: projectId as ProjectId,
    sessionId: 'sess-1' as SessionId,
    text,
    channel: 'whatsapp',
    ts: Date.now(),
  };
}

describe('createProjectEventBus', () => {
  it('delivers emitted events only to listeners of the matching projectId', () => {
    const bus = createProjectEventBus();
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    bus.subscribe('proj-a' as ProjectId, listenerA);
    bus.subscribe('proj-b' as ProjectId, listenerB);

    bus.emit(makeEvent('proj-a'));

    expect(listenerA).toHaveBeenCalledOnce();
    expect(listenerB).not.toHaveBeenCalled();
  });

  it('unsubscribe removes the listener', () => {
    const bus = createProjectEventBus();
    const listener = vi.fn();

    const unsubscribe = bus.subscribe('proj-a' as ProjectId, listener);
    bus.emit(makeEvent('proj-a'));
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    bus.emit(makeEvent('proj-a'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('supports many concurrent listeners without maxListeners warning', () => {
    const bus = createProjectEventBus();
    const listeners = Array.from({ length: 500 }, () => vi.fn());

    // Install 500 listeners for the same project
    /* eslint-disable no-console */
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
      for (const l of listeners) bus.subscribe('proj-a' as ProjectId, l);
      bus.emit(makeEvent('proj-a'));
    } finally {
      console.warn = originalWarn;
    }
    /* eslint-enable no-console */

    for (const l of listeners) expect(l).toHaveBeenCalledOnce();
    expect(warned).toBe(false);
  });

  it('listenerCount reflects current subscribers', () => {
    const bus = createProjectEventBus();
    expect(bus.listenerCount('proj-a' as ProjectId)).toBe(0);

    const unsub1 = bus.subscribe('proj-a' as ProjectId, vi.fn());
    const unsub2 = bus.subscribe('proj-a' as ProjectId, vi.fn());
    expect(bus.listenerCount('proj-a' as ProjectId)).toBe(2);

    unsub1();
    expect(bus.listenerCount('proj-a' as ProjectId)).toBe(1);
    unsub2();
    expect(bus.listenerCount('proj-a' as ProjectId)).toBe(0);
  });

  it('subscribeAll receives events for every project', () => {
    const bus = createProjectEventBus();
    const globalListener = vi.fn();
    bus.subscribeAll(globalListener);

    bus.emit(makeEvent('proj-a'));
    bus.emit(makeEvent('proj-b'));

    expect(globalListener).toHaveBeenCalledTimes(2);
  });

  it('subscribeAll unsubscribe stops delivery', () => {
    const bus = createProjectEventBus();
    const globalListener = vi.fn();
    const unsub = bus.subscribeAll(globalListener);

    bus.emit(makeEvent('proj-a'));
    unsub();
    bus.emit(makeEvent('proj-b'));

    expect(globalListener).toHaveBeenCalledOnce();
  });

  it('carries full event payload to the listener', () => {
    const bus = createProjectEventBus();
    const listener = vi.fn();
    bus.subscribe('proj-a' as ProjectId, listener);

    const event = makeEvent('proj-a', 'ping');
    bus.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
  });
});
