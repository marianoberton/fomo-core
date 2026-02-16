import { describe, it, expect, vi } from 'vitest';
import { createHandoffManager, DEFAULT_HANDOFF_CONFIG } from './handoff.js';
import type { ChatwootAdapter } from './adapters/chatwoot.js';

function createMockLogger(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

function createMockAdapter(): ChatwootAdapter {
  return {
    channelType: 'chatwoot',
    accountId: 1,
    projectId: 'proj-001',
    send: vi.fn().mockResolvedValue({ success: true }),
    parseInbound: vi.fn().mockResolvedValue(null),
    isHealthy: vi.fn().mockResolvedValue(true),
    handoffToHuman: vi.fn().mockResolvedValue(undefined),
    resumeBot: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatwootAdapter;
}

describe('HandoffManager', () => {
  const logger = createMockLogger();

  describe('shouldEscalateFromResponse', () => {
    it('detects handoff marker in response', () => {
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      expect(manager.shouldEscalateFromResponse('Lo siento, necesitas hablar con un humano [HANDOFF]')).toBe(true);
    });

    it('returns false when no marker present', () => {
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      expect(manager.shouldEscalateFromResponse('Aqui esta tu respuesta normal')).toBe(false);
    });

    it('supports custom markers', () => {
      const manager = createHandoffManager({
        config: { ...DEFAULT_HANDOFF_CONFIG, handoffMarker: '{{HUMAN}}' },
        logger: logger as never,
      });

      expect(manager.shouldEscalateFromResponse('Need help {{HUMAN}}')).toBe(true);
      expect(manager.shouldEscalateFromResponse('Need help [HANDOFF]')).toBe(false);
    });
  });

  describe('shouldEscalateFromMessage', () => {
    it('detects Spanish escalation keywords', () => {
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      expect(manager.shouldEscalateFromMessage('quiero hablar con humano')).toBe(true);
      expect(manager.shouldEscalateFromMessage('hablar con humano')).toBe(true);
      expect(manager.shouldEscalateFromMessage('AGENTE HUMANO')).toBe(true);
      expect(manager.shouldEscalateFromMessage('necesito un operador')).toBe(true);
    });

    it('detects English escalation keywords', () => {
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      expect(manager.shouldEscalateFromMessage('talk to human')).toBe(true);
      expect(manager.shouldEscalateFromMessage('I want to speak to agent')).toBe(true);
      expect(manager.shouldEscalateFromMessage('human agent please')).toBe(true);
    });

    it('returns false for normal messages', () => {
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      expect(manager.shouldEscalateFromMessage('Cual es el precio?')).toBe(false);
      expect(manager.shouldEscalateFromMessage('Hello')).toBe(false);
    });
  });

  describe('stripHandoffMarker', () => {
    it('removes the marker and trims', () => {
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      expect(manager.stripHandoffMarker('Lo siento [HANDOFF]')).toBe('Lo siento');
      expect(manager.stripHandoffMarker('[HANDOFF] Transferiendo')).toBe('Transferiendo');
    });

    it('handles response with only marker', () => {
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      expect(manager.stripHandoffMarker('[HANDOFF]')).toBe('');
    });
  });

  describe('escalate', () => {
    it('calls adapter handoffToHuman with context note', async () => {
      const adapter = createMockAdapter();
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      await manager.escalate(42, adapter, 'Cliente solicito humano');

       
      expect(adapter.handoffToHuman).toHaveBeenCalledWith(
        42,
        expect.stringContaining('Cliente solicito humano'),
      );
    });
  });

  describe('resume', () => {
    it('calls adapter resumeBot', async () => {
      const adapter = createMockAdapter();
      const manager = createHandoffManager({
        config: DEFAULT_HANDOFF_CONFIG,
        logger: logger as never,
      });

      await manager.resume(42, adapter);

       
      expect(adapter.resumeBot).toHaveBeenCalledWith(42);
    });
  });
});
