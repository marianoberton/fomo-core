/**
 * Tests for metrics collection and Prometheus exposition.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import {
  recordMessage,
  recordLatency,
  resetMetrics,
  formatPrometheusMetrics,
  registerMetricsRoute,
} from './metrics.js';
import type { Logger } from '@/observability/logger.js';

// ─── Mocks ──────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe('recordMessage', () => {
    it('increments counter for agent+channel', () => {
      recordMessage('agent-1', 'whatsapp');
      recordMessage('agent-1', 'whatsapp');
      recordMessage('agent-1', 'telegram');

      const output = formatPrometheusMetrics();
      expect(output).toContain('nexus_messages_processed_total{agent="agent-1",channel="whatsapp"} 2');
      expect(output).toContain('nexus_messages_processed_total{agent="agent-1",channel="telegram"} 1');
    });
  });

  describe('recordLatency', () => {
    it('records latency samples and computes percentiles', () => {
      // Record 100 samples from 1ms to 100ms
      for (let i = 1; i <= 100; i++) {
        recordLatency('agent-1', i);
      }

      const output = formatPrometheusMetrics();
      expect(output).toContain('nexus_agent_response_duration_ms{agent="agent-1",quantile="0.5"}');
      expect(output).toContain('nexus_agent_response_duration_ms{agent="agent-1",quantile="0.95"}');
      expect(output).toContain('nexus_agent_response_duration_ms{agent="agent-1",quantile="0.99"}');
      expect(output).toContain('nexus_agent_response_duration_ms_count{agent="agent-1"} 100');
    });

    it('computes correct p50 value', () => {
      // 10 samples: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
      for (let i = 1; i <= 10; i++) {
        recordLatency('agent-p50', i * 10);
      }

      const output = formatPrometheusMetrics();
      // p50 of [10,20,30,40,50,60,70,80,90,100] → index ceil(0.5*10)-1 = 4 → 50
      expect(output).toContain('nexus_agent_response_duration_ms{agent="agent-p50",quantile="0.5"} 50');
    });
  });

  describe('formatPrometheusMetrics', () => {
    it('returns valid Prometheus text with HELP and TYPE headers', () => {
      recordMessage('a1', 'slack');

      const output = formatPrometheusMetrics();
      expect(output).toContain('# HELP nexus_messages_processed_total');
      expect(output).toContain('# TYPE nexus_messages_processed_total counter');
      expect(output).toContain('# HELP nexus_agent_response_duration_ms');
      expect(output).toContain('# TYPE nexus_agent_response_duration_ms summary');
    });

    it('returns empty metrics when nothing recorded', () => {
      const output = formatPrometheusMetrics();
      expect(output).toContain('# HELP');
      // No actual metric lines
      expect(output).not.toContain('nexus_messages_processed_total{');
    });
  });

  describe('registerMetricsRoute', () => {
    it('responds with Prometheus text format on GET /metrics', async () => {
      recordMessage('test-agent', 'api');

      const app = Fastify();
      registerMetricsRoute(app, { logger: createMockLogger() });

      const response = await app.inject({ method: 'GET', url: '/metrics' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toContain('nexus_messages_processed_total{agent="test-agent",channel="api"} 1');

      await app.close();
    });
  });
});
