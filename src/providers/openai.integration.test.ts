/**
 * OpenAI provider integration tests.
 * Tests real API calls with streaming.
 *
 * Requires OPENAI_API_KEY environment variable.
 * Skipped in CI unless the key is available.
 */
import { describe, it, expect } from 'vitest';
import { createOpenAIProvider } from './openai.js';
import type { ChatEvent } from './types.js';

const hasApiKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasApiKey)('OpenAI Provider Integration', () => {
  it('makes real API call and streams text response', async () => {
    const provider = createOpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini',
    });

    const events: ChatEvent[] = [];
    for await (const event of provider.chat({
      systemPrompt: 'You are a helpful assistant. Be very brief.',
      messages: [{ role: 'user', content: 'Say hello in exactly 3 words.' }],
    })) {
      events.push(event);
    }

    // Should have message_start
    expect(events.some((e) => e.type === 'message_start')).toBe(true);

    // Should have content deltas
    const contentEvents = events.filter((e) => e.type === 'content_delta');
    expect(contentEvents.length).toBeGreaterThan(0);

    // Should have message_end with usage
    const endEvent = events.find((e) => e.type === 'message_end');
    expect(endEvent).toBeDefined();
    if (endEvent?.type === 'message_end') {
      expect(endEvent.stopReason).toBe('end_turn');
      expect(endEvent.usage.inputTokens).toBeGreaterThan(0);
      expect(endEvent.usage.outputTokens).toBeGreaterThan(0);
    }
  }, 30_000);

  it('handles tool use with function calling', async () => {
    const provider = createOpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini',
    });

    const tools = provider.formatTools([
      {
        name: 'calculator',
        description: 'Performs arithmetic calculations.',
        inputSchema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'The math expression to evaluate' },
          },
          required: ['expression'],
        },
      },
    ]);

    const events: ChatEvent[] = [];
    for await (const event of provider.chat({
      systemPrompt: 'You are a math assistant. Always use the calculator tool for math.',
      messages: [{ role: 'user', content: 'What is 127 times 834?' }],
      tools: tools as ChatEvent[],
    })) {
      events.push(event);
    }

    // Should have tool use events
    const toolStartEvents = events.filter((e) => e.type === 'tool_use_start');
    const toolEndEvents = events.filter((e) => e.type === 'tool_use_end');

    expect(toolStartEvents.length).toBeGreaterThan(0);
    expect(toolEndEvents.length).toBeGreaterThan(0);

    // Tool end should have the parsed input
    if (toolEndEvents[0]?.type === 'tool_use_end') {
      expect(toolEndEvents[0].name).toBe('calculator');
      expect(toolEndEvents[0].input).toBeDefined();
    }

    // Stop reason should be tool_use
    const endEvent = events.find((e) => e.type === 'message_end');
    if (endEvent?.type === 'message_end') {
      expect(endEvent.stopReason).toBe('tool_use');
    }
  }, 30_000);

  it('reports token usage accurately', async () => {
    const provider = createOpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini',
    });

    const events: ChatEvent[] = [];
    for await (const event of provider.chat({
      systemPrompt: 'Reply with exactly one word.',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      events.push(event);
    }

    const endEvent = events.find((e) => e.type === 'message_end');
    expect(endEvent).toBeDefined();

    if (endEvent?.type === 'message_end') {
      // Input tokens should be reasonable (system + user message ~ 15-30 tokens)
      expect(endEvent.usage.inputTokens).toBeGreaterThan(5);
      expect(endEvent.usage.inputTokens).toBeLessThan(100);

      // Output tokens should be minimal (one word ~ 1-3 tokens)
      expect(endEvent.usage.outputTokens).toBeGreaterThan(0);
      expect(endEvent.usage.outputTokens).toBeLessThan(20);
    }
  }, 30_000);

  it('counts tokens via rough estimate', async () => {
    const provider = createOpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini',
    });

    const count = await provider.countTokens([
      { role: 'user', content: 'Hello world, this is a test message for counting tokens.' },
    ]);

    // ~56 chars / 4 = ~14 tokens
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(50);
  });

  it('returns correct context window size', () => {
    const provider = createOpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini',
    });

    expect(provider.getContextWindow()).toBe(128_000);
    expect(provider.supportsToolUse()).toBe(true);
  });
});
