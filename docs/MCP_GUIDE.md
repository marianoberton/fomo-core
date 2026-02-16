# MCP Guide — Connecting External Tools to Nexus Core

## What is MCP?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open standard that allows AI agents to discover and use external tools at runtime. Nexus Core has full MCP client support — you configure MCP servers per project, and the agent automatically discovers and uses the tools they expose.

## How It Works in Nexus Core

```
AgentConfig.mcpServers[]
    ↓
MCPManager.connectAll()
    ↓  (stdio subprocess or SSE HTTP)
MCPClient ←→ MCP Server
    ↓
MCPToolAdapter wraps each tool as ExecutableTool
    ↓
ToolRegistry (enforces RBAC via allowedTools whitelist)
    ↓
Agent uses tools transparently
```

**Key components:**

| Component | Location | Purpose |
|-----------|----------|---------|
| `MCPManager` | `src/mcp/mcp-manager.ts` | Manages multiple MCP connections per project |
| `MCPClient` | `src/mcp/mcp-client.ts` | Single connection to one MCP server |
| `MCPToolAdapter` | `src/mcp/mcp-tool-adapter.ts` | Wraps MCP tools as `ExecutableTool` for the registry |
| `MCPServerConfig` | `src/mcp/types.ts` | Server configuration types |

## Transport Types

### stdio (Recommended for Development)

Nexus Core spawns the MCP server as a child process. Communication happens over stdin/stdout.

**Pros:** No network dependencies, simple setup, works offline
**Cons:** One process per project, doesn't scale horizontally

```typescript
{
  name: "my-server",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@anthropic/mcp-server-filesystem"],
  env: {
    "ALLOWED_DIRS": "/tmp/safe"
  }
}
```

### SSE (Recommended for Production)

Nexus Core connects to the MCP server via HTTP Server-Sent Events.

**Pros:** Multiple agents share one server, independently scalable
**Cons:** Requires HTTP endpoint, network dependency

```typescript
{
  name: "my-server",
  transport: "sse",
  url: "http://mcp-server:8080/mcp"
}
```

## Configuration

MCP servers are configured per project in the `mcpServers` array of `AgentConfig`:

```typescript
{
  projectId: "proj_123",
  provider: { ... },
  allowedTools: [
    "calculator",                           // Built-in tool
    "mcp:google-calendar:list_events",      // MCP tool (prefixed)
    "mcp:google-calendar:create_event",     // MCP tool (prefixed)
  ],
  mcpServers: [
    {
      name: "google-calendar",              // Server name
      transport: "stdio",                   // stdio or sse
      command: "npx",                       // Command to run
      args: ["-y", "@anthropic/mcp-google-calendar"],
      env: {
        "GOOGLE_CALENDAR_CREDENTIALS": "GOOGLE_CALENDAR_JSON"  // Env var NAME
      },
    }
  ],
}
```

### Tool Naming Convention

MCP tools are namespaced as: `mcp:<serverName>:<toolName>`

For example, if server name is `github` and the tool is `create_pr`:
- Tool ID: `mcp:github:create_pr`
- Must be in `allowedTools` to be usable

### Environment Variables

The `env` field maps env var **names** (not values). Nexus Core resolves them at runtime:

```typescript
env: {
  "GOOGLE_CALENDAR_CREDENTIALS": "GOOGLE_CALENDAR_JSON"
  //   ↑ passed to MCP server        ↑ looked up from process.env
}
```

This ensures secrets are never stored in project configuration.

## Example 1: Google Calendar

Connect your agent to Google Calendar for scheduling and event management.

### Setup

1. Create Google Cloud credentials (OAuth2 or Service Account)
2. Set env var: `GOOGLE_CALENDAR_JSON=<path-to-credentials.json>`
3. Configure in project:

```typescript
{
  mcpServers: [
    {
      name: "google-calendar",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@anthropic/mcp-google-calendar"],
      env: {
        "GOOGLE_CALENDAR_CREDENTIALS": "GOOGLE_CALENDAR_JSON"
      }
    }
  ],
  allowedTools: [
    "mcp:google-calendar:list_events",
    "mcp:google-calendar:create_event",
    "mcp:google-calendar:update_event",
    "mcp:google-calendar:delete_event",
  ]
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_events` | List upcoming calendar events |
| `create_event` | Create a new calendar event |
| `update_event` | Update an existing event |
| `delete_event` | Delete a calendar event |

## Example 2: GitHub

Connect your agent to GitHub for repository management, issues, and PRs.

### Setup

1. Create a GitHub Personal Access Token (PAT)
2. Set env var: `GITHUB_PAT=ghp_your_token_here`
3. Configure in project:

```typescript
{
  mcpServers: [
    {
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PAT"
      }
    }
  ],
  allowedTools: [
    "mcp:github:create_or_update_file",
    "mcp:github:search_repositories",
    "mcp:github:create_issue",
    "mcp:github:create_pull_request",
    "mcp:github:list_issues",
    "mcp:github:get_file_contents",
  ]
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search_repositories` | Search GitHub repositories |
| `create_issue` | Create a new issue |
| `list_issues` | List issues with filters |
| `create_pull_request` | Create a pull request |
| `get_file_contents` | Read file from a repository |
| `create_or_update_file` | Create or update a file |

## Example 3: Filesystem (Sandboxed)

Allow agents to read/write files in a restricted directory.

### Setup

```typescript
{
  mcpServers: [
    {
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/agent-workspace"],
    }
  ],
  allowedTools: [
    "mcp:filesystem:read_file",
    "mcp:filesystem:write_file",
    "mcp:filesystem:list_directory",
  ]
}
```

## Example 4: Custom MCP Server (Fomo Platform)

Connect to the Fomo Platform MCP server that exposes CRM, pipeline, and task management.
The server lives inside Nexus Core at `src/mcp/servers/fomo-platform/` and calls Supabase PostgREST API directly.

### Setup

1. Set env vars in `.env`:
   ```bash
   FOMO_SUPABASE_URL=https://your-project.supabase.co
   FOMO_SUPABASE_KEY=eyJhbGc...          # Supabase service role key
   FOMO_COMPANY_ID=uuid-of-your-company  # Multi-tenant scope
   ```
2. Build Nexus Core: `pnpm build`
3. Configure in project:

```typescript
{
  mcpServers: [
    {
      name: "fomo-platform",
      transport: "stdio",
      command: "node",
      args: ["dist/mcp/servers/fomo-platform/index.js"],
      env: {
        "SUPABASE_URL": "FOMO_SUPABASE_URL",
        "SUPABASE_SERVICE_KEY": "FOMO_SUPABASE_KEY",
        "FOMO_COMPANY_ID": "FOMO_COMPANY_ID"
      }
    }
  ],
  allowedTools: [
    "mcp:fomo-platform:search-clients",
    "mcp:fomo-platform:get-client-detail",
    "mcp:fomo-platform:list-contacts",
    "mcp:fomo-platform:list-opportunities",
    "mcp:fomo-platform:update-opportunity-stage",
    "mcp:fomo-platform:list-temas",
    "mcp:fomo-platform:create-tema-task",
  ]
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search-clients` | Search CRM clients by name, email, or CUIT |
| `get-client-detail` | Get client with contacts and related temas |
| `list-contacts` | List CRM contacts, optionally filter by client |
| `list-opportunities` | List sales pipeline with stage/client filters |
| `update-opportunity-stage` | Move opportunity through pipeline stages |
| `list-temas` | List temas (cases/projects) with status/priority filters |
| `create-tema-task` | Create a task within a tema |

## Building Your Own MCP Server

### Minimal Example

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "my-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "hello",
      description: "Returns a greeting",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name to greet" }
        },
        required: ["name"]
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "hello") {
    return {
      content: [{ type: "text", text: `Hello, ${args.name}!` }]
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1"
  }
}
```

### Testing Your MCP Server

```bash
# Test standalone (stdio mode)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js

# Test via Nexus Core
pnpm test src/mcp/mcp-client.test.ts
```

## Debugging

### Check MCP Connection Status

Look for these log messages on server startup:

```
MCP server connected: google-calendar (stdio, 4 tools discovered)
MCP server connected: github (stdio, 6 tools discovered)
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `No tools discovered` | Server not responding to `tools/list` | Test server standalone first |
| `Tool not found` | Tool not in `allowedTools` | Add `mcp:<server>:<tool>` to allowedTools |
| `Connection refused` | SSE server not running | Start the MCP server first |
| `Missing env var` | Env var not set in process | Check `.env` file |
| `Spawn error` | Command not found (stdio) | Install package globally or use `npx -y` |
| `Tool hallucination` | Agent tried non-existent tool | ToolRegistry blocks it, logs event |

### Health Checks

```typescript
// Check if MCPClient is connected
const isHealthy = await mcpClient.isHealthy();

// List discovered tools
const tools = await mcpClient.listTools();
console.log(`Discovered ${tools.length} tools`);
```

### Logs

All MCP operations are logged with `component: 'mcp-manager'` or `component: 'mcp-client'`:

```bash
# Filter MCP logs
pnpm dev 2>&1 | grep '"component":"mcp'
```

## Security Considerations

1. **Env vars only** — Never store secrets in project config. Use env var names that resolve at runtime.
2. **Tool whitelist** — Only tools listed in `allowedTools` can be called. MCP tools follow the same RBAC as built-in tools.
3. **Approval gates** — Set `riskLevel: 'high'` on MCP tools via `MCPToolAdapter` options to require human approval.
4. **Sandbox stdio** — When using filesystem MCP servers, restrict to safe directories.
5. **Network isolation** — For SSE servers in production, use internal network (not public internet).

## References

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Server Registry](https://github.com/modelcontextprotocol/servers)
- [Nexus Core MCP Implementation](../src/mcp/)
