/**
 * Tests for OpenClaw Task Registry — in-memory task lifecycle tracking.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTaskRegistry } from './openclaw-task-registry.js';
import type { TaskRegistry } from './openclaw-task-registry.js';

describe('openclaw-task-registry', () => {
  let registry: TaskRegistry & { shutdown: () => void };

  beforeEach(() => {
    registry = createTaskRegistry({ pruneIntervalMs: 60_000 });
  });

  afterEach(() => {
    registry.shutdown();
  });

  // ─── create ─────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a task entry with running status', () => {
      registry.create('task-1', 'agent-abc', 'proj-1');

      const entry = registry.get('task-1');
      expect(entry).toBeDefined();
      expect(entry?.taskId).toBe('task-1');
      expect(entry?.agentId).toBe('agent-abc');
      expect(entry?.status).toBe('running');
      expect(entry?.events).toEqual([]);
      expect(entry?.createdAt).toBeInstanceOf(Date);
    });

    it('should return an AbortController', () => {
      const controller = registry.create('task-2', 'agent-xyz', 'proj-1');

      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal.aborted).toBe(false);
    });

    it('should store callback URL', () => {
      registry.create('task-3', 'agent-1', 'proj-1', 'https://callback.example.com');

      const entry = registry.get('task-3');
      expect(entry?.callbackUrl).toBe('https://callback.example.com');
    });
  });

  // ─── get ────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return undefined for unknown task', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  // ─── addEvent ───────────────────────────────────────────────────

  describe('addEvent', () => {
    it('should buffer events on a running task', () => {
      registry.create('task-e', 'agent-1', 'proj-1');

      registry.addEvent('task-e', { type: 'agent_start', sessionId: 's1', traceId: 't1' });
      registry.addEvent('task-e', { type: 'content_delta', text: 'hello' });

      const entry = registry.get('task-e');
      expect(entry?.events).toHaveLength(2);
      expect(entry?.events[0]).toEqual({ type: 'agent_start', sessionId: 's1', traceId: 't1' });
    });

    it('should not add events to completed tasks', () => {
      registry.create('task-f', 'agent-1', 'proj-1');
      registry.complete('task-f', {
        response: 'done',
        traceId: 't1',
        sessionId: 's1',
        usage: { totalTokens: 100, costUSD: 0.01 },
        timestamp: new Date().toISOString(),
      });

      registry.addEvent('task-f', { type: 'content_delta', text: 'late' });

      const entry = registry.get('task-f');
      expect(entry?.events).toHaveLength(0);
    });

    it('should not add events to unknown tasks (no-op)', () => {
      // Should not throw
      registry.addEvent('unknown', { type: 'content_delta', text: 'x' });
    });
  });

  // ─── complete ───────────────────────────────────────────────────

  describe('complete', () => {
    it('should mark task as completed with result', () => {
      registry.create('task-c', 'agent-1', 'proj-1');

      const result = {
        response: 'All done',
        traceId: 'trace-123',
        sessionId: 'sess-1',
        usage: { totalTokens: 500, costUSD: 0.05 },
        timestamp: new Date().toISOString(),
      };

      registry.complete('task-c', result);

      const entry = registry.get('task-c');
      expect(entry?.status).toBe('completed');
      expect(entry?.completedAt).toBeInstanceOf(Date);
      expect(entry?.result?.response).toBe('All done');
      expect(entry?.result?.traceId).toBe('trace-123');
    });

    it('should not complete a non-running task', () => {
      registry.create('task-d', 'agent-1', 'proj-1');
      registry.cancel('task-d');

      registry.complete('task-d', {
        response: 'late',
        traceId: 't',
        sessionId: 's',
        usage: { totalTokens: 0, costUSD: 0 },
        timestamp: new Date().toISOString(),
      });

      const entry = registry.get('task-d');
      expect(entry?.status).toBe('cancelled');
    });
  });

  // ─── fail ───────────────────────────────────────────────────────

  describe('fail', () => {
    it('should mark task as failed with error message', () => {
      registry.create('task-fail', 'agent-1', 'proj-1');

      registry.fail('task-fail', 'Budget exceeded');

      const entry = registry.get('task-fail');
      expect(entry?.status).toBe('failed');
      expect(entry?.error).toBe('Budget exceeded');
      expect(entry?.completedAt).toBeInstanceOf(Date);
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel a running task and abort its controller', () => {
      const controller = registry.create('task-cancel', 'agent-1', 'proj-1');

      const cancelled = registry.cancel('task-cancel');

      expect(cancelled).toBe(true);
      expect(controller.signal.aborted).toBe(true);
      expect(registry.get('task-cancel')?.status).toBe('cancelled');
    });

    it('should return false for non-running task', () => {
      registry.create('task-x', 'agent-1', 'proj-1');
      registry.fail('task-x', 'oops');

      expect(registry.cancel('task-x')).toBe(false);
    });

    it('should return false for unknown task', () => {
      expect(registry.cancel('unknown')).toBe(false);
    });
  });

  // ─── list ───────────────────────────────────────────────────────

  describe('list', () => {
    it('should list all tasks when no filter', () => {
      registry.create('t1', 'a1', 'p1');
      registry.create('t2', 'a2', 'p1');
      registry.create('t3', 'a1', 'p1');

      expect(registry.list()).toHaveLength(3);
    });

    it('should filter by status', () => {
      registry.create('t1', 'a1', 'p1');
      registry.create('t2', 'a1', 'p1');
      registry.fail('t2', 'err');

      const running = registry.list({ status: 'running' });
      expect(running).toHaveLength(1);
      expect(running.at(0)?.taskId).toBe('t1');
    });

    it('should filter by agentId', () => {
      registry.create('t1', 'a1', 'p1');
      registry.create('t2', 'a2', 'p1');

      const a1Tasks = registry.list({ agentId: 'a1' });
      expect(a1Tasks).toHaveLength(1);
    });

    it('should filter by both status and agentId', () => {
      registry.create('t1', 'a1', 'p1');
      registry.create('t2', 'a1', 'p1');
      registry.fail('t2', 'err');
      registry.create('t3', 'a2', 'p1');

      const result = registry.list({ status: 'running', agentId: 'a1' });
      expect(result).toHaveLength(1);
      expect(result.at(0)?.taskId).toBe('t1');
    });
  });

  // ─── countActive ───────────────────────────────────────────────

  describe('countActive', () => {
    it('should count running tasks for an agent', () => {
      registry.create('t1', 'a1', 'p1');
      registry.create('t2', 'a1', 'p1');
      registry.create('t3', 'a2', 'p1');
      registry.fail('t2', 'err');

      expect(registry.countActive('a1')).toBe(1);
      expect(registry.countActive('a2')).toBe(1);
      expect(registry.countActive('unknown')).toBe(0);
    });
  });

  // ─── prune ─────────────────────────────────────────────────────

  describe('prune', () => {
    it('should prune completed tasks older than maxAgeMs', () => {
      registry.create('old', 'a1', 'p1');
      registry.complete('old', {
        response: 'x',
        traceId: 't',
        sessionId: 's',
        usage: { totalTokens: 0, costUSD: 0 },
        timestamp: new Date().toISOString(),
      });

      // Manually set completedAt to the past
      const entry = registry.get('old');
      expect(entry).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      entry!.completedAt = new Date(Date.now() - 120_000);

      registry.create('recent', 'a1', 'p1');
      registry.complete('recent', {
        response: 'y',
        traceId: 't2',
        sessionId: 's2',
        usage: { totalTokens: 0, costUSD: 0 },
        timestamp: new Date().toISOString(),
      });

      const pruned = registry.prune(60_000); // 1 minute
      expect(pruned).toBe(1);
      expect(registry.get('old')).toBeUndefined();
      expect(registry.get('recent')).toBeDefined();
    });

    it('should not prune running tasks', () => {
      registry.create('running', 'a1', 'p1');

      const pruned = registry.prune(0);
      expect(pruned).toBe(0);
      expect(registry.get('running')).toBeDefined();
    });
  });
});
