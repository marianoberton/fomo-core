#!/usr/bin/env node
/**
 * Fomo Platform MCP Server
 *
 * Exposes Fomo Platform CRM/Tasks data to Nexus Core agents via MCP (stdio).
 * Connects directly to Supabase PostgREST API using service role key.
 *
 * Required environment variables:
 *   SUPABASE_URL         — Supabase project URL (e.g. https://xxx.supabase.co)
 *   SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)
 *   FOMO_COMPANY_ID      — Company UUID to scope all operations
 *
 * Usage:
 *   node dist/mcp/servers/fomo-platform/index.js
 *
 * In Nexus Core MCPServerConfig:
 *   {
 *     name: 'fomo-platform',
 *     transport: 'stdio',
 *     command: 'node',
 *     args: ['dist/mcp/servers/fomo-platform/index.js'],
 *     env: {
 *       SUPABASE_URL: 'FOMO_SUPABASE_URL',
 *       SUPABASE_SERVICE_KEY: 'FOMO_SUPABASE_KEY',
 *       FOMO_COMPANY_ID: 'FOMO_COMPANY_ID',
 *     },
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createFomoApiClient } from './api-client.js';

// ─── Validate Environment ────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`Missing required environment variable: ${name}\n`);
    process.exit(1);
  }
  return value;
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_KEY');
const companyId = requireEnv('FOMO_COMPANY_ID');

// ─── API Client ──────────────────────────────────────────────────────

const api = createFomoApiClient({ supabaseUrl, serviceRoleKey, companyId });

// ─── MCP Server ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-deprecated
const server = new Server(
  { name: 'fomo-platform', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool Definitions ────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'search-clients',
    description:
      'Search CRM clients (companies) by name, email, or CUIT. Returns basic client info.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search term (matches name, email, or CUIT)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'get-client-detail',
    description:
      'Get detailed info about a specific client, including their contacts and related temas (cases/projects).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        clientId: {
          type: 'string',
          description: 'UUID of the client',
        },
      },
      required: ['clientId'],
    },
  },
  {
    name: 'list-contacts',
    description:
      'List CRM contacts (people). Optionally filter by client or search by name/email.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        clientId: {
          type: 'string',
          description: 'Filter contacts by client UUID',
        },
        query: {
          type: 'string',
          description: 'Search by first name, last name, or email',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 30)',
        },
      },
    },
  },
  {
    name: 'list-opportunities',
    description:
      'List sales pipeline opportunities. Shows title, stage, value, and related client.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stage: {
          type: 'string',
          enum: ['calificacion', 'propuesta', 'negociacion', 'cierre'],
          description: 'Filter by pipeline stage',
        },
        clientId: {
          type: 'string',
          description: 'Filter by client UUID',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
    },
  },
  {
    name: 'update-opportunity-stage',
    description:
      'Move a sales opportunity to a new pipeline stage. When closing as won/lost, specify outcome.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        opportunityId: {
          type: 'string',
          description: 'UUID of the opportunity',
        },
        stage: {
          type: 'string',
          enum: ['calificacion', 'propuesta', 'negociacion', 'cierre'],
          description: 'Target pipeline stage',
        },
        outcome: {
          type: 'string',
          enum: ['won', 'lost'],
          description: 'Required when stage is "cierre"',
        },
        lossReason: {
          type: 'string',
          description: 'Reason for loss (when outcome is "lost")',
        },
      },
      required: ['opportunityId', 'stage'],
    },
  },
  {
    name: 'list-temas',
    description:
      'List temas (cases/projects/expedientes). Filter by status, priority, or search by title.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: [
            'nuevo_expediente',
            'caratulado',
            'seguimiento',
            'subsanacion',
            'observado',
            'subsanacion_cerrada',
            'completado',
            'finalizado',
          ],
          description: 'Filter by tema status',
        },
        priority: {
          type: 'string',
          enum: ['baja', 'media', 'alta'],
          description: 'Filter by priority',
        },
        query: {
          type: 'string',
          description: 'Search by title, reference code, or description',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
    },
  },
  {
    name: 'create-tema-task',
    description:
      'Create a new task within a tema (case/project). The task starts in "pending" status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        temaId: {
          type: 'string',
          description: 'UUID of the tema to add the task to',
        },
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
        assignedTo: {
          type: 'string',
          description: 'UUID of the user to assign the task to',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in ISO 8601 format (YYYY-MM-DD)',
        },
      },
      required: ['temaId', 'title'],
    },
  },
] as const;

// ─── Request Handlers ────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, () =>
  Promise.resolve({ tools: [...TOOL_DEFINITIONS] }),
);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments ?? {});

  try {
    let result: unknown;

    switch (name) {
      case 'search-clients':
        result = await api.searchClients({
          query: args['query'] as string | undefined,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'get-client-detail':
        result = await api.getClientDetail(args['clientId'] as string);
        break;

      case 'list-contacts':
        result = await api.listContacts({
          clientId: args['clientId'] as string | undefined,
          query: args['query'] as string | undefined,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'list-opportunities':
        result = await api.listOpportunities({
          stage: args['stage'] as string | undefined,
          clientId: args['clientId'] as string | undefined,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'update-opportunity-stage':
        result = await api.updateOpportunityStage({
          opportunityId: args['opportunityId'] as string,
          stage: args['stage'] as string,
          outcome: args['outcome'] as string | undefined,
          lossReason: args['lossReason'] as string | undefined,
        });
        break;

      case 'list-temas':
        result = await api.listTemas({
          status: args['status'] as string | undefined,
          priority: args['priority'] as string | undefined,
          query: args['query'] as string | undefined,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'create-tema-task':
        result = await api.createTemaTask({
          temaId: args['temaId'] as string,
          title: args['title'] as string,
          description: args['description'] as string | undefined,
          assignedTo: args['assignedTo'] as string | undefined,
          dueDate: args['dueDate'] as string | undefined,
        });
        break;

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
