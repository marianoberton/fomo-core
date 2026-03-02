#!/usr/bin/env node
/**
 * HubSpot CRM MCP Server
 *
 * Exposes HubSpot CRM data (contacts, deals, companies) to Nexus Core agents via MCP (stdio).
 * Supports read (search, get) and write (update stage, add note, create task) operations.
 *
 * Required environment variables:
 *   HUBSPOT_ACCESS_TOKEN — HubSpot Private App access token
 *
 * Usage:
 *   node dist/mcp/servers/hubspot-crm/index.js
 *
 * In Nexus Core MCPServerConfig:
 *   {
 *     name: 'hubspot-crm',
 *     transport: 'stdio',
 *     command: 'node',
 *     args: ['dist/mcp/servers/hubspot-crm/index.js'],
 *     env: { HUBSPOT_ACCESS_TOKEN: 'HUBSPOT_ACCESS_TOKEN' },
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createHubSpotApiClient } from './api-client.js';

// ─── Validate Environment ────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`Missing required environment variable: ${name}\n`);
    process.exit(1);
  }
  return value;
}

const accessToken = requireEnv('HUBSPOT_ACCESS_TOKEN');

// ─── API Client ──────────────────────────────────────────────────────

const api = createHubSpotApiClient({ accessToken });

// ─── MCP Server ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-deprecated
const server = new Server(
  { name: 'hubspot-crm', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool Definitions ────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'search-contacts',
    description:
      'Search HubSpot contacts by phone number, email address, or name. Use this to find a customer in the CRM.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'General search term (matches first name, last name, or email)',
        },
        email: {
          type: 'string',
          description: 'Exact email address to look up',
        },
        phone: {
          type: 'string',
          description: 'Phone number to search (partial match, ignores formatting)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10, max: 100)',
        },
      },
    },
  },
  {
    name: 'search-deals',
    description:
      'Search HubSpot deals by pipeline stage, inactivity period, pipeline, or owner. ' +
      'Use this to find deals matching specific criteria (e.g. cold leads with no activity in 3+ days). ' +
      'Results are sorted oldest-first so you can prioritize stale deals.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stage: {
          type: 'string',
          description: 'Deal stage ID to filter by (e.g. "quotationsent", "negotiation", "closedlost")',
        },
        pipeline: {
          type: 'string',
          description: 'Pipeline ID to filter by (omit for all pipelines)',
        },
        inactiveDays: {
          type: 'number',
          description: 'Only return deals with no notes/activity in this many days (e.g. 3 = inactive for 3+ days)',
        },
        ownerId: {
          type: 'string',
          description: 'HubSpot owner ID — only deals assigned to this owner',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20, max: 100)',
        },
      },
    },
  },
  {
    name: 'get-contact-deals',
    description:
      'Get all deals associated with a HubSpot contact. Returns deal name, stage, amount, and close date.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contactId: {
          type: 'string',
          description: 'HubSpot contact ID (from search-contacts results)',
        },
        limit: {
          type: 'number',
          description: 'Max deals to return (default: 10)',
        },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'get-deal-detail',
    description:
      'Get full details of a HubSpot deal, including associated contacts and companies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dealId: {
          type: 'string',
          description: 'HubSpot deal ID',
        },
      },
      required: ['dealId'],
    },
  },
  {
    name: 'get-company-detail',
    description:
      'Get company details from HubSpot by company ID. Returns name, domain, industry, and location.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        companyId: {
          type: 'string',
          description: 'HubSpot company ID (from deal associations)',
        },
      },
      required: ['companyId'],
    },
  },
  {
    name: 'update-deal-stage',
    description:
      'Move a deal to a new pipeline stage in HubSpot. Use this to track deal progression.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dealId: {
          type: 'string',
          description: 'HubSpot deal ID',
        },
        stage: {
          type: 'string',
          description: 'Target pipeline stage ID (e.g. "appointmentscheduled", "qualifiedtobuy", "closedwon")',
        },
        pipeline: {
          type: 'string',
          description: 'Pipeline ID (only needed if the deal could be in multiple pipelines)',
        },
      },
      required: ['dealId', 'stage'],
    },
  },
  {
    name: 'add-deal-note',
    description:
      'Add a note/engagement to a HubSpot deal. Use this to log important conversation details or decisions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dealId: {
          type: 'string',
          description: 'HubSpot deal ID to attach the note to',
        },
        body: {
          type: 'string',
          description: 'Note content (plain text or HTML)',
        },
      },
      required: ['dealId', 'body'],
    },
  },
  {
    name: 'create-deal-task',
    description:
      'Create a follow-up task linked to a HubSpot deal. Use this to schedule actions like callbacks or meetings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dealId: {
          type: 'string',
          description: 'HubSpot deal ID to link the task to',
        },
        subject: {
          type: 'string',
          description: 'Task title/subject',
        },
        body: {
          type: 'string',
          description: 'Task description or details',
        },
        priority: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH'],
          description: 'Task priority (default: MEDIUM)',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in ISO 8601 format (e.g. "2026-03-01T10:00:00Z")',
        },
        ownerId: {
          type: 'string',
          description: 'HubSpot owner ID to assign the task to',
        },
      },
      required: ['dealId', 'subject'],
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
      case 'search-contacts':
        result = await api.searchContacts({
          query: args['query'] as string | undefined,
          email: args['email'] as string | undefined,
          phone: args['phone'] as string | undefined,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'search-deals':
        result = await api.searchDeals({
          stage: args['stage'] as string | undefined,
          pipeline: args['pipeline'] as string | undefined,
          inactiveDays: args['inactiveDays'] as number | undefined,
          ownerId: args['ownerId'] as string | undefined,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'get-contact-deals':
        result = await api.getContactDeals({
          contactId: args['contactId'] as string,
          limit: args['limit'] as number | undefined,
        });
        break;

      case 'get-deal-detail':
        result = await api.getDealDetail({
          dealId: args['dealId'] as string,
        });
        break;

      case 'get-company-detail':
        result = await api.getCompanyDetail({
          companyId: args['companyId'] as string,
        });
        break;

      case 'update-deal-stage':
        result = await api.updateDealStage({
          dealId: args['dealId'] as string,
          stage: args['stage'] as string,
          pipeline: args['pipeline'] as string | undefined,
        });
        break;

      case 'add-deal-note':
        result = await api.addDealNote({
          dealId: args['dealId'] as string,
          body: args['body'] as string,
        });
        break;

      case 'create-deal-task':
        result = await api.createDealTask({
          dealId: args['dealId'] as string,
          subject: args['subject'] as string,
          body: args['body'] as string | undefined,
          priority: args['priority'] as string | undefined,
          dueDate: args['dueDate'] as string | undefined,
          ownerId: args['ownerId'] as string | undefined,
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
