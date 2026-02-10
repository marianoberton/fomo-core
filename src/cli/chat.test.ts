/**
 * Tests for CLI chat pure functions.
 */
import { describe, it, expect } from 'vitest';
import { parseCliArgs, parseCommand, formatToolUse, formatToolResult, formatUsage } from './chat.js';

// ─── ANSI helpers (match source) ────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';

// ─── parseCliArgs ───────────────────────────────────────────────

describe('parseCliArgs', () => {
  it('returns defaults when no args given', () => {
    const result = parseCliArgs([]);
    expect(result).toEqual({
      serverUrl: 'http://localhost:3002',
    });
    expect(result.projectId).toBeUndefined();
  });

  it('parses --project flag', () => {
    const result = parseCliArgs(['--project', 'abc123']);
    expect(result.projectId).toBe('abc123');
  });

  it('parses -p shorthand', () => {
    const result = parseCliArgs(['-p', 'abc123']);
    expect(result.projectId).toBe('abc123');
  });

  it('parses --server flag', () => {
    const result = parseCliArgs(['--server', 'http://example.com:4000']);
    expect(result.serverUrl).toBe('http://example.com:4000');
  });

  it('parses -s shorthand', () => {
    const result = parseCliArgs(['-s', 'http://example.com:4000']);
    expect(result.serverUrl).toBe('http://example.com:4000');
  });

  it('parses both flags together', () => {
    const result = parseCliArgs(['--project', 'proj1', '--server', 'http://host:5000']);
    expect(result.projectId).toBe('proj1');
    expect(result.serverUrl).toBe('http://host:5000');
  });

  it('ignores unknown flags', () => {
    const result = parseCliArgs(['--unknown', 'value', '-p', 'proj1']);
    expect(result.projectId).toBe('proj1');
  });
});

// ─── parseCommand ───────────────────────────────────────────────

describe('parseCommand', () => {
  it('parses /quit command', () => {
    expect(parseCommand('/quit')).toEqual({ type: 'quit' });
  });

  it('parses /exit command', () => {
    expect(parseCommand('/exit')).toEqual({ type: 'quit' });
  });

  it('parses /q shorthand', () => {
    expect(parseCommand('/q')).toEqual({ type: 'quit' });
  });

  it('parses /new command', () => {
    expect(parseCommand('/new')).toEqual({ type: 'new' });
  });

  it('parses /help command', () => {
    expect(parseCommand('/help')).toEqual({ type: 'help' });
  });

  it('parses /h shorthand', () => {
    expect(parseCommand('/h')).toEqual({ type: 'help' });
  });

  it('treats regular text as message', () => {
    expect(parseCommand('Hello world')).toEqual({ type: 'message', text: 'Hello world' });
  });

  it('trims whitespace from input', () => {
    expect(parseCommand('  /quit  ')).toEqual({ type: 'quit' });
  });

  it('returns empty message for blank input', () => {
    expect(parseCommand('')).toEqual({ type: 'message', text: '' });
  });

  it('treats whitespace-only as empty message', () => {
    expect(parseCommand('   ')).toEqual({ type: 'message', text: '' });
  });
});

// ─── formatToolUse ──────────────────────────────────────────────

describe('formatToolUse', () => {
  it('formats tool use with input', () => {
    const result = formatToolUse({
      type: 'tool_use_start',
      toolId: 'calculator',
      input: { operation: 'multiply', a: 42, b: 17 },
    });
    expect(result).toContain('calculator');
    expect(result).toContain('multiply');
    expect(result).toContain(DIM);
    expect(result).toContain(RESET);
  });

  it('truncates long input', () => {
    const longInput: Record<string, unknown> = { data: 'x'.repeat(200) };
    const result = formatToolUse({
      type: 'tool_use_start',
      toolId: 'json-transform',
      input: longInput,
    });
    expect(result).toContain('...');
  });

  it('handles missing input', () => {
    const result = formatToolUse({
      type: 'tool_use_start',
      toolId: 'date-time',
    });
    expect(result).toContain('date-time');
  });
});

// ─── formatToolResult ───────────────────────────────────────────

describe('formatToolResult', () => {
  it('formats successful result', () => {
    const result = formatToolResult({
      type: 'tool_result',
      success: true,
      output: { value: 714 },
    });
    expect(result).toContain('714');
    expect(result).toContain(DIM);
  });

  it('formats error result', () => {
    const result = formatToolResult({
      type: 'tool_result',
      success: false,
      error: 'Division by zero',
    });
    expect(result).toContain('Division by zero');
    expect(result).toContain(RED);
  });

  it('handles string output', () => {
    const result = formatToolResult({
      type: 'tool_result',
      success: true,
      output: 'plain text result',
    });
    expect(result).toContain('plain text result');
  });

  it('truncates long output', () => {
    const result = formatToolResult({
      type: 'tool_result',
      success: true,
      output: 'x'.repeat(300),
    });
    expect(result).toContain('...');
  });
});

// ─── formatUsage ────────────────────────────────────────────────

describe('formatUsage', () => {
  it('formats token count and cost', () => {
    const result = formatUsage({ totalTokens: 847, costUSD: 0.001 });
    expect(result).toContain('847 tokens');
    expect(result).toContain('$0.0010');
    expect(result).toContain(DIM);
  });

  it('formats zero cost', () => {
    const result = formatUsage({ totalTokens: 0, costUSD: 0 });
    expect(result).toContain('0 tokens');
    expect(result).toContain('$0.0000');
  });
});
