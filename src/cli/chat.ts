/**
 * Interactive CLI chat client for Nexus Core.
 *
 * Pure WebSocket client — zero imports from server code.
 * Uses only Node.js 22 built-ins: WebSocket, fetch, readline, process.
 *
 * Usage: pnpm chat [--project <id>] [--server <url>]
 */
import { createInterface } from 'readline';

// ─── ANSI Colors ────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

// ─── CLI Arg Parsing ────────────────────────────────────────────

interface CliArgs {
  projectId?: string;
  serverUrl: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { serverUrl: 'http://localhost:3002' };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === '--project' || arg === '-p') && next) {
      args.projectId = next;
      i++;
    } else if ((arg === '--server' || arg === '-s') && next) {
      args.serverUrl = next;
      i++;
    }
  }

  return args;
}

// ─── Command Parsing ────────────────────────────────────────────

interface Command {
  type: 'quit' | 'new' | 'help' | 'message';
  text?: string;
}

export function parseCommand(input: string): Command {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'message', text: '' };

  if (trimmed === '/quit' || trimmed === '/exit' || trimmed === '/q') {
    return { type: 'quit' };
  }
  if (trimmed === '/new') {
    return { type: 'new' };
  }
  if (trimmed === '/help' || trimmed === '/h') {
    return { type: 'help' };
  }
  return { type: 'message', text: trimmed };
}

// ─── Stream Event Formatting ────────────────────────────────────

interface StreamEvent {
  type: string;
  text?: string;
  sessionId?: string;
  traceId?: string;
  toolCallId?: string;
  toolId?: string;
  input?: Record<string, unknown>;
  success?: boolean;
  output?: unknown;
  error?: string;
  response?: string;
  usage?: { totalTokens: number; costUSD: number };
  status?: string;
  code?: string;
  message?: string;
  turnNumber?: number;
}

export function formatToolUse(event: StreamEvent): string {
  const inputStr = event.input ? JSON.stringify(event.input) : '';
  const truncated = inputStr.length > 120 ? inputStr.slice(0, 117) + '...' : inputStr;
  return `${DIM}  [tool] ${event.toolId} ${truncated}${RESET}`;
}

export function formatToolResult(event: StreamEvent): string {
  if (!event.success) {
    return `${RED}  [error] ${event.error ?? 'Tool failed'}${RESET}`;
  }
  const outputStr = typeof event.output === 'string'
    ? event.output
    : JSON.stringify(event.output);
  const truncated = outputStr.length > 200 ? outputStr.slice(0, 197) + '...' : outputStr;
  return `${DIM}  [result] ${truncated}${RESET}`;
}

export function formatUsage(usage: { totalTokens: number; costUSD: number }): string {
  return `${DIM}  (${usage.totalTokens} tokens | $${usage.costUSD.toFixed(4)})${RESET}`;
}

// ─── API Helpers ────────────────────────────────────────────────

interface ApiProject {
  id: string;
  name: string;
  description?: string;
  status: string;
}

async function listProjects(serverUrl: string): Promise<ApiProject[]> {
  const res = await fetch(`${serverUrl}/projects`);
  const body = await res.json() as { success: boolean; data?: ApiProject[] };
  if (!body.success || !body.data) {
    throw new Error('Failed to fetch projects');
  }
  return body.data;
}

async function getProject(serverUrl: string, projectId: string): Promise<ApiProject> {
  const res = await fetch(`${serverUrl}/projects/${projectId}`);
  const body = await res.json() as { success: boolean; data?: ApiProject };
  if (!body.success || !body.data) {
    throw new Error(`Project "${projectId}" not found`);
  }
  return body.data;
}

// ─── Project Selection ──────────────────────────────────────────

async function selectProject(
  serverUrl: string,
  rl: ReturnType<typeof createInterface>,
): Promise<string> {
  const projects = await listProjects(serverUrl);
  const active = projects.filter((p) => p.status === 'active');

  if (active.length === 0) {
    console.log(`${RED}No active projects found.${RESET}`);
    console.log(`Run ${CYAN}pnpm db:seed:fomo${RESET} to create the Fomo assistant.`);
    process.exit(1);
  }

  console.log(`\n${BOLD}Available projects:${RESET}\n`);
  for (const [i, p] of active.entries()) {
    console.log(`  ${CYAN}${i + 1}.${RESET} ${p.name} ${DIM}(${p.id})${RESET}`);
    if (p.description) {
      console.log(`     ${DIM}${p.description}${RESET}`);
    }
  }

  return new Promise((resolve) => {
    rl.question(`\n${BOLD}Select project [1-${active.length}]:${RESET} `, (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      const selected = active[idx];
      if (selected) {
        resolve(selected.id);
      } else {
        console.log(`${RED}Invalid selection.${RESET}`);
        process.exit(1);
      }
    });
  });
}

// ─── Help ───────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${BOLD}Commands:${RESET}
  ${CYAN}/help${RESET}    Show this help
  ${CYAN}/new${RESET}     Start a new session
  ${CYAN}/quit${RESET}    Exit the chat
  ${CYAN}Ctrl+C${RESET}   Exit the chat
`);
}

// ─── Main Chat Loop ─────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Banner
  console.log(`\n${BOLD}${CYAN}  Nexus Core — Interactive Chat${RESET}`);
  console.log(`${DIM}  Type /help for commands, /quit to exit${RESET}\n`);

  // Resolve project
  let projectId: string;
  if (args.projectId) {
    try {
      const project = await getProject(args.serverUrl, args.projectId);
      projectId = project.id;
      console.log(`${DIM}  Project: ${project.name} (${project.id})${RESET}\n`);
    } catch {
      console.log(`${RED}Project "${args.projectId}" not found.${RESET}`);
      rl.close();
      process.exit(1);
    }
  } else {
    projectId = await selectProject(args.serverUrl, rl);
    try {
      const project = await getProject(args.serverUrl, projectId);
      console.log(`\n${DIM}  Project: ${project.name}${RESET}\n`);
    } catch {
      // Already selected, proceed anyway
    }
  }

  // WebSocket URL
  const wsBase = args.serverUrl.replace(/^http/, 'ws');
  let sessionId: string | undefined;
  let ws: WebSocket | undefined;

  function connectWebSocket(): WebSocket {
    const socket = new WebSocket(`${wsBase}/chat/stream`);
    return socket;
  }

  function prompt(): void {
    rl.question(`${GREEN}You:${RESET} `, (input) => {
      const cmd = parseCommand(input);

      switch (cmd.type) {
        case 'quit':
          console.log(`\n${DIM}Goodbye!${RESET}\n`);
          ws?.close();
          rl.close();
          process.exit(0);
          break;

        case 'new':
          sessionId = undefined;
          console.log(`${YELLOW}Session cleared. Starting fresh.${RESET}\n`);
          prompt();
          break;

        case 'help':
          printHelp();
          prompt();
          break;

        case 'message':
          if (!cmd.text) {
            prompt();
            return;
          }
          sendMessage(cmd.text);
          break;
      }
    });
  }

  function sendMessage(text: string): void {
    ws = connectWebSocket();

    ws.onopen = () => {
      const payload = JSON.stringify({
        projectId,
        ...(sessionId && { sessionId }),
        message: text,
      });
      ws?.send(payload);
    };

    ws.onerror = (event) => {
      const errorMsg = 'message' in event ? (event as ErrorEvent).message : 'Connection failed';
      console.log(`\n${RED}Connection error: ${errorMsg}${RESET}`);
      console.log(`${DIM}Is the server running? Try: pnpm dev${RESET}\n`);
      prompt();
    };

    let isFirstContent = true;

    ws.onmessage = (event) => {
      let data: StreamEvent;
      try {
        data = JSON.parse(String(event.data)) as StreamEvent;
      } catch {
        return;
      }

      switch (data.type) {
        case 'agent_start':
          if (data.sessionId) {
            sessionId = data.sessionId;
          }
          process.stdout.write(`\n${MAGENTA}Nexus:${RESET} `);
          isFirstContent = true;
          break;

        case 'content_delta':
          if (data.text) {
            if (isFirstContent) {
              isFirstContent = false;
            }
            process.stdout.write(data.text);
          }
          break;

        case 'tool_use_start':
          // If we were in the middle of content, newline first
          if (!isFirstContent) {
            process.stdout.write('\n');
            isFirstContent = true;
          }
          console.log(formatToolUse(data));
          break;

        case 'tool_result':
          console.log(formatToolResult(data));
          break;

        case 'turn_complete':
          // Silent — just marks end of a turn
          break;

        case 'agent_complete':
          // Ensure newline after streamed content
          if (!isFirstContent) {
            process.stdout.write('\n');
          }
          if (data.usage) {
            console.log(formatUsage(data.usage));
          }
          console.log('');
          ws?.close();
          prompt();
          break;

        case 'error':
          if (!isFirstContent) {
            process.stdout.write('\n');
          }
          console.log(`${RED}Error [${data.code}]: ${data.message}${RESET}\n`);
          ws?.close();
          prompt();
          break;
      }
    };

    ws.onclose = () => {
      // Handled by agent_complete/error events above
    };
  }

  // Handle Ctrl+C
  rl.on('close', () => {
    console.log(`\n${DIM}Goodbye!${RESET}\n`);
    ws?.close();
    process.exit(0);
  });

  // Start the prompt loop
  prompt();
}

// ─── Entry Point ────────────────────────────────────────────────

import { fileURLToPath } from 'url';

// Only run when invoked directly (not when imported for testing)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}
