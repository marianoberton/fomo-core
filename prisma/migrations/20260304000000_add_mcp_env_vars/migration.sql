-- Add envVars field to MCPServerInstance for direct key=value env vars passed to subprocess
ALTER TABLE "mcp_server_instances" ADD COLUMN "env_vars" JSONB;
