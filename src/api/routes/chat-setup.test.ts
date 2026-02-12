/**
 * Tests for shared chat setup logic — prepareChatRun, extraction helpers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PromptLayerId, SessionId } from '@/core/types.js';
import type { PromptLayerType } from '@/prompts/types.js';
import {
  createMockDeps,
  createSampleProject,
  createSampleSession,
  createSamplePromptLayer,
  createSampleMessage,
} from '@/testing/fixtures/routes.js';
import {
  prepareChatRun,
  extractAssistantResponse,
  extractToolCalls,
} from './chat-setup.js';

// ─── Mocks for factory functions ────────────────────────────────

vi.mock('@/providers/factory.js', () => ({
  createProvider: vi.fn().mockReturnValue({
    chat: vi.fn(),
    countTokens: vi.fn(),
    formatTools: vi.fn(),
  }),
}));

vi.mock('@/memory/memory-manager.js', () => ({
  createMemoryManager: vi.fn().mockReturnValue({
    fitToContextWindow: vi.fn(),
    retrieveMemories: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('@/cost/cost-guard.js', () => ({
  createCostGuard: vi.fn().mockReturnValue({
    precheck: vi.fn(),
    recordUsage: vi.fn(),
  }),
  createInMemoryUsageStore: vi.fn().mockReturnValue({}),
}));

vi.mock('@/security/input-sanitizer.js', () => ({
  validateUserInput: vi.fn().mockReturnValue({
    sanitized: 'Hello',
    injectionDetected: false,
    detectedPatterns: [],
    wasTruncated: false,
  }),
}));

// ─── Helpers ────────────────────────────────────────────────────

type MockDeps = ReturnType<typeof createMockDeps>;

/** Configure promptLayerRepository.getActiveLayer to return a layer per type. */
function mockActiveLayersForAllTypes(deps: MockDeps): void {
  deps.promptLayerRepository.getActiveLayer.mockImplementation(
    (_projectId: string, layerType: PromptLayerType) =>
      Promise.resolve(
        createSamplePromptLayer({
          id: `pl-${layerType}-1` as PromptLayerId,
          layerType,
          content: `${layerType} content`,
        }),
      ),
  );
}

// ─── prepareChatRun Tests ───────────────────────────────────────

describe('prepareChatRun', () => {
  let deps: MockDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it('returns setup result on success with existing session', async () => {
    const project = createSampleProject();
    const session = createSampleSession();

    deps.projectRepository.findById.mockResolvedValue(project);
    deps.sessionRepository.findById.mockResolvedValue(session);
    mockActiveLayersForAllTypes(deps);
    deps.sessionRepository.getMessages.mockResolvedValue([]);

    const result = await prepareChatRun(
      { projectId: 'proj-1', sessionId: 'sess-1', message: 'Hello' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sanitizedMessage).toBe('Hello');
      expect(result.value.sessionId).toBe('sess-1');
      expect(result.value.conversationHistory).toEqual([]);
      expect(result.value.provider).toBeDefined();
      expect(result.value.memoryManager).toBeDefined();
      expect(result.value.costGuard).toBeDefined();
    }
  });

  it('creates a new session when sessionId is not provided', async () => {
    const project = createSampleProject();
    const newSession = createSampleSession({ id: 'sess-new' as SessionId });

    deps.projectRepository.findById.mockResolvedValue(project);
    deps.sessionRepository.create.mockResolvedValue(newSession);
    mockActiveLayersForAllTypes(deps);
    deps.sessionRepository.getMessages.mockResolvedValue([]);

    const result = await prepareChatRun(
      { projectId: 'proj-1', message: 'Hello' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).toBe('sess-new');
    }

     
    expect(deps.sessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' }),
    );
  });

  it('returns error when project is not found', async () => {
    deps.projectRepository.findById.mockResolvedValue(null);

    const result = await prepareChatRun(
      { projectId: 'bad-id', message: 'Hello' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.statusCode).toBe(404);
      expect(result.error.message).toContain('bad-id');
    }
  });

  it('returns error when session is not found', async () => {
    const project = createSampleProject();
    deps.projectRepository.findById.mockResolvedValue(project);
    deps.sessionRepository.findById.mockResolvedValue(null);

    const result = await prepareChatRun(
      { projectId: 'proj-1', sessionId: 'bad-sess', message: 'Hello' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.statusCode).toBe(404);
      expect(result.error.message).toContain('bad-sess');
    }
  });

  it('returns error when no active prompt layers exist', async () => {
    const project = createSampleProject();
    const session = createSampleSession();

    deps.projectRepository.findById.mockResolvedValue(project);
    deps.sessionRepository.findById.mockResolvedValue(session);
    deps.promptLayerRepository.getActiveLayer.mockResolvedValue(null);

    const result = await prepareChatRun(
      { projectId: 'proj-1', sessionId: 'sess-1', message: 'Hello' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_ACTIVE_PROMPT');
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('loads conversation history from session messages', async () => {
    const project = createSampleProject();
    const session = createSampleSession();

    deps.projectRepository.findById.mockResolvedValue(project);
    deps.sessionRepository.findById.mockResolvedValue(session);
    mockActiveLayersForAllTypes(deps);
    deps.sessionRepository.getMessages.mockResolvedValue([
      createSampleMessage({ role: 'user', content: 'First' }),
      createSampleMessage({ role: 'assistant', content: 'Reply' }),
    ]);

    const result = await prepareChatRun(
      { projectId: 'proj-1', sessionId: 'sess-1', message: 'Second' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.conversationHistory).toEqual([
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply' },
      ]);
    }
  });

  it('passes metadata when creating a new session', async () => {
    const project = createSampleProject();
    const newSession = createSampleSession();

    deps.projectRepository.findById.mockResolvedValue(project);
    deps.sessionRepository.create.mockResolvedValue(newSession);
    mockActiveLayersForAllTypes(deps);
    deps.sessionRepository.getMessages.mockResolvedValue([]);

    await prepareChatRun(
      { projectId: 'proj-1', message: 'Hello', metadata: { source: 'web' } },
      deps,
    );

     
    expect(deps.sessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { source: 'web' } }),
    );
  });
});

// ─── extractAssistantResponse Tests ─────────────────────────────

describe('extractAssistantResponse', () => {
  it('extracts text from the last llm_response event', () => {
    const events = [
      { type: 'llm_response', data: { text: 'First response' } },
      { type: 'tool_call', data: { toolId: 'calc' } },
      { type: 'llm_response', data: { text: 'Final answer' } },
    ];

    expect(extractAssistantResponse(events)).toBe('Final answer');
  });

  it('returns empty string when no llm_response events exist', () => {
    const events = [
      { type: 'tool_call', data: { toolId: 'calc' } },
      { type: 'tool_result', data: { output: '4' } },
    ];

    expect(extractAssistantResponse(events)).toBe('');
  });

  it('returns empty string for empty events array', () => {
    expect(extractAssistantResponse([])).toBe('');
  });

  it('returns empty string when text is not a string', () => {
    const events = [
      { type: 'llm_response', data: { text: 42 } },
    ];

    expect(extractAssistantResponse(events)).toBe('');
  });
});

// ─── extractToolCalls Tests ─────────────────────────────────────

describe('extractToolCalls', () => {
  it('pairs tool calls with their results', () => {
    const events = [
      {
        type: 'tool_call',
        data: { toolCallId: 'tc-1', toolId: 'calculator', input: { expr: '2+2' } },
      },
      {
        type: 'tool_result',
        data: { toolCallId: 'tc-1', toolId: 'calculator', output: '4' },
      },
    ];

    const result = extractToolCalls(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      toolId: 'calculator',
      input: { expr: '2+2' },
      result: '4',
    });
  });

  it('handles tool calls without matching results', () => {
    const events = [
      {
        type: 'tool_call',
        data: { toolCallId: 'tc-1', toolId: 'calculator', input: { expr: '1+1' } },
      },
    ];

    const result = extractToolCalls(events);
    expect(result).toHaveLength(1);
    expect(result[0]?.result).toBeUndefined();
  });

  it('handles multiple tool calls', () => {
    const events = [
      {
        type: 'tool_call',
        data: { toolCallId: 'tc-1', toolId: 'calculator', input: { expr: '2+2' } },
      },
      {
        type: 'tool_call',
        data: { toolCallId: 'tc-2', toolId: 'date-time', input: { tz: 'UTC' } },
      },
      {
        type: 'tool_result',
        data: { toolCallId: 'tc-1', toolId: 'calculator', output: '4' },
      },
      {
        type: 'tool_result',
        data: { toolCallId: 'tc-2', toolId: 'date-time', output: '2025-01-01T00:00:00Z' },
      },
    ];

    const result = extractToolCalls(events);
    expect(result).toHaveLength(2);
    expect(result[0]?.toolId).toBe('calculator');
    expect(result[1]?.toolId).toBe('date-time');
  });

  it('returns empty array when no tool events exist', () => {
    const events = [
      { type: 'llm_response', data: { text: 'Hello' } },
    ];

    expect(extractToolCalls(events)).toHaveLength(0);
  });

  it('defaults toolId and input when missing from data', () => {
    const events = [
      { type: 'tool_call', data: { toolCallId: 'tc-1' } },
    ];

    const result = extractToolCalls(events);
    expect(result[0]?.toolId).toBe('');
    expect(result[0]?.input).toEqual({});
  });
});
