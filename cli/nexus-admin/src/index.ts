#!/usr/bin/env node
/**
 * nexus-admin — CLI for FOMO-Admin autonomous agent.
 *
 * Usage:
 *   nexus-admin "analizá los traces de los últimos 7 días"
 *   nexus-admin --session <id> "continuá el análisis"
 *   nexus-admin --session-history <id>
 *
 * Config: NEXUS_API_KEY + NEXUS_API_URL env vars (or ~/.nexus/admin.json)
 */
import { createInterface } from 'readline';
import { loadConfig } from './config.js';

// ─── ANSI colors ────────────────────────────────────────────────

const R   = '\x1b[0m';
const B   = '\x1b[1m';
const DIM = '\x1b[2m';
const CY  = '\x1b[36m';
const GR  = '\x1b[32m';
const YE  = '\x1b[33m';
const RE  = '\x1b[31m';
const MA  = '\x1b[35m';

// ─── API response types ─────────────────────────────────────────

interface ToolCall {
  toolId: string;
  input: Record<string, unknown>;
  result: unknown;
}

interface InvokeResponse {
  success: boolean;
  data?: {
    sessionId: string;
    traceId: string;
    response: string;
    toolCalls: ToolCall[];
    timestamp: string;
    usage: { totalTokens: number; costUSD: number };
  };
  error?: { code: string; message: string };
}

interface SessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface SessionResponse {
  success: boolean;
  data?: {
    session: { id: string; status: string; createdAt: string };
    messages: SessionMessage[];
  };
  error?: { code: string; message: string };
}

// ─── CLI arg parsing ─────────────────────────────────────────────

interface CliArgs {
  prompt?: string;
  sessionId?: string;
  showHistory?: string;
  interactive: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { interactive: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if ((arg === '--session' || arg === '-s') && next) {
      args.sessionId = next;
      i++;
    } else if (arg === '--session-history' && next) {
      args.showHistory = next;
      i++;
    } else if (arg === '--interactive' || arg === '-i') {
      args.interactive = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    args.prompt = positional.join(' ');
  }

  return args;
}

// ─── API calls ──────────────────────────────────────────────────

async function invokeAdmin(
  apiUrl: string,
  apiKey: string,
  prompt: string,
  sessionId?: string,
): Promise<InvokeResponse> {
  const res = await fetch(`${apiUrl}/api/v1/admin/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ prompt, sessionId }),
  });

  return res.json() as Promise<InvokeResponse>;
}

async function getSessionHistory(
  apiUrl: string,
  apiKey: string,
  sessionId: string,
): Promise<SessionResponse> {
  const res = await fetch(`${apiUrl}/api/v1/admin/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return res.json() as Promise<SessionResponse>;
}

// ─── Rendering ──────────────────────────────────────────────────

function renderToolCalls(toolCalls: ToolCall[]): void {
  if (toolCalls.length === 0) return;
  console.log(`\n${DIM}─── Tool calls ────────────────────────${R}`);
  for (const tc of toolCalls) {
    console.log(`${DIM}  ${YE}${tc.toolId}${R}`);
    const inputStr = JSON.stringify(tc.input, null, 2)
      .split('\n')
      .map((l) => `    ${DIM}${l}${R}`)
      .join('\n');
    console.log(inputStr);
  }
}

function renderResponse(data: InvokeResponse['data']): void {
  if (!data) return;

  console.log(`\n${B}${CY}FOMO-Admin${R}`);
  console.log(`${DIM}Session: ${data.sessionId} · Trace: ${data.traceId}${R}`);
  console.log();
  console.log(data.response);
  renderToolCalls(data.toolCalls);
  console.log(
    `\n${DIM}Tokens: ${data.usage.totalTokens} · Cost: $${data.usage.costUSD.toFixed(4)}${R}`,
  );
}

function renderSessionHistory(data: SessionResponse['data']): void {
  if (!data) return;

  console.log(`\n${B}Session ${data.session.id}${R} (${data.session.status})\n`);
  for (const msg of data.messages) {
    const ts = new Date(msg.createdAt).toLocaleTimeString();
    if (msg.role === 'user') {
      console.log(`${DIM}[${ts}] ${YE}You:${R} ${msg.content}`);
    } else {
      console.log(`${DIM}[${ts}] ${CY}FOMO-Admin:${R} ${msg.content}`);
    }
    console.log();
  }
}

// ─── Interactive mode ────────────────────────────────────────────

async function runInteractive(apiUrl: string, apiKey: string): Promise<void> {
  let sessionId: string | undefined;

  console.log(`${B}${MA}nexus-admin${R} ${DIM}interactive mode${R}`);
  console.log(`${DIM}Commands: /quit /session /new${R}\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${GR}admin>${R} `,
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === '/quit' || input === '/exit' || input === '/q') {
      console.log(`${DIM}Bye.${R}`);
      rl.close();
      return;
    }

    if (input === '/new') {
      sessionId = undefined;
      console.log(`${DIM}New session started.${R}\n`);
      rl.prompt();
      return;
    }

    if (input === '/session') {
      console.log(sessionId ? `${DIM}Session: ${sessionId}${R}` : `${DIM}No active session.${R}`);
      rl.prompt();
      return;
    }

    process.stdout.write(`${DIM}thinking...${R}\r`);

    try {
      const res = await invokeAdmin(apiUrl, apiKey, input, sessionId);

      process.stdout.write('              \r');

      if (!res.success || !res.data) {
        console.error(`${RE}Error: ${res.error?.message ?? 'Unknown error'}${R}\n`);
        rl.prompt();
        return;
      }

      sessionId = res.data.sessionId;
      renderResponse(res.data);
      console.log();
    } catch (e) {
      process.stdout.write('              \r');
      console.error(`${RE}Request failed: ${e instanceof Error ? e.message : String(e)}${R}\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));

  // Show session history
  if (args.showHistory) {
    const res = await getSessionHistory(config.apiUrl, config.apiKey, args.showHistory);
    if (!res.success || !res.data) {
      console.error(`${RE}Error: ${res.error?.message ?? 'Not found'}${R}`);
      process.exit(1);
    }
    renderSessionHistory(res.data);
    return;
  }

  // Interactive mode (no prompt given, or --interactive flag)
  if (!args.prompt || args.interactive) {
    await runInteractive(config.apiUrl, config.apiKey);
    return;
  }

  // One-shot mode
  console.log(`${B}${MA}nexus-admin${R} ${DIM}→ FOMO-Admin${R}`);
  if (args.sessionId) console.log(`${DIM}Session: ${args.sessionId}${R}`);
  console.log(`${DIM}thinking...${R}`);

  const res = await invokeAdmin(config.apiUrl, config.apiKey, args.prompt, args.sessionId);

  if (!res.success || !res.data) {
    console.error(`\n${RE}Error: ${res.error?.message ?? 'Unknown error'}${R}`);
    process.exit(1);
  }

  renderResponse(res.data);

  // Print session ID for easy chaining
  console.log(`\n${DIM}To continue: nexus-admin --session ${res.data.sessionId} "tu mensaje"${R}`);
}

main().catch((e: unknown) => {
  console.error(`${RE}Fatal: ${e instanceof Error ? e.message : String(e)}${R}`);
  process.exit(1);
});
