/**
 * Metrics service — collects agent/channel counters and latency histograms.
 * Exposes GET /metrics in Prometheus text exposition format.
 */
import type { FastifyInstance } from 'fastify';
import type { Logger } from '@/observability/logger.js';

// ─── Types ──────────────────────────────────────────────────────

export interface MetricsDeps {
  logger: Logger;
}

// ─── Internal Storage ───────────────────────────────────────────

/** Messages processed per agent+channel. */
const messageCounters = new Map<string, number>();

/** Response latency samples per agent (milliseconds). */
const latencySamples = new Map<string, number[]>();

// ─── Public API ─────────────────────────────────────────────────

/** Key for message counter map. */
function counterKey(agentId: string, channel: string): string {
  return `${agentId}:${channel}`;
}

/**
 * Record a processed message for the given agent and channel.
 * Call this after each agent run completes.
 */
export function recordMessage(agentId: string, channel: string): void {
  const key = counterKey(agentId, channel);
  messageCounters.set(key, (messageCounters.get(key) ?? 0) + 1);
}

/**
 * Record agent response latency in milliseconds.
 * Call this with the total duration from the execution trace.
 */
export function recordLatency(agentId: string, durationMs: number): void {
  const samples = latencySamples.get(agentId) ?? [];
  samples.push(durationMs);
  // Keep a rolling window of 1000 samples to bound memory
  if (samples.length > 1000) {
    samples.splice(0, samples.length - 1000);
  }
  latencySamples.set(agentId, samples);
}

/**
 * Reset all metrics (for testing).
 */
export function resetMetrics(): void {
  messageCounters.clear();
  latencySamples.clear();
}

// ─── Percentile Calculation ─────────────────────────────────────

/** Compute a percentile from a sorted array of numbers. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

// ─── Prometheus Formatting ──────────────────────────────────────

/** Format all collected metrics in Prometheus text exposition format. */
export function formatPrometheusMetrics(): string {
  const lines: string[] = [];

  // Message counters
  lines.push('# HELP nexus_messages_processed_total Total messages processed per agent and channel.');
  lines.push('# TYPE nexus_messages_processed_total counter');
  for (const [key, count] of messageCounters.entries()) {
    const [agentId, channel] = key.split(':');
    lines.push(`nexus_messages_processed_total{agent="${agentId}",channel="${channel}"} ${count}`);
  }

  // Latency histograms (p50, p95, p99)
  lines.push('# HELP nexus_agent_response_duration_ms Agent response latency in milliseconds.');
  lines.push('# TYPE nexus_agent_response_duration_ms summary');
  for (const [agentId, samples] of latencySamples.entries()) {
    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const sum = sorted.reduce((a, b) => a + b, 0);
    lines.push(`nexus_agent_response_duration_ms{agent="${agentId}",quantile="0.5"} ${p50}`);
    lines.push(`nexus_agent_response_duration_ms{agent="${agentId}",quantile="0.95"} ${p95}`);
    lines.push(`nexus_agent_response_duration_ms{agent="${agentId}",quantile="0.99"} ${p99}`);
    lines.push(`nexus_agent_response_duration_ms_sum{agent="${agentId}"} ${sum}`);
    lines.push(`nexus_agent_response_duration_ms_count{agent="${agentId}"} ${sorted.length}`);
  }

  return lines.join('\n') + '\n';
}

// ─── Route Registration ─────────────────────────────────────────

/** Register the /metrics endpoint on the Fastify instance. */
export function registerMetricsRoute(fastify: FastifyInstance, deps: MetricsDeps): void {
  const { logger } = deps;

  fastify.get('/metrics', async (_request, reply) => {
    logger.debug('Metrics endpoint hit', { component: 'metrics' });
    const body = formatPrometheusMetrics();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(body);
  });
}
