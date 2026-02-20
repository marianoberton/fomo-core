-- MCP Server Templates (global catalog)
CREATE TABLE "mcp_server_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "command" TEXT,
    "args" TEXT[],
    "default_env" JSONB,
    "url" TEXT,
    "tool_prefix" TEXT,
    "required_secrets" TEXT[],
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_templates_pkey" PRIMARY KEY ("id")
);

-- MCP Server Instances (per-project)
CREATE TABLE "mcp_server_instances" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "transport" TEXT NOT NULL,
    "command" TEXT,
    "args" TEXT[],
    "env_secret_keys" JSONB,
    "url" TEXT,
    "tool_prefix" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_instances_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "mcp_server_templates_name_key" ON "mcp_server_templates"("name");
CREATE UNIQUE INDEX "mcp_server_instances_project_id_name_key" ON "mcp_server_instances"("project_id", "name");

-- Indexes
CREATE INDEX "mcp_server_templates_category_idx" ON "mcp_server_templates"("category");
CREATE INDEX "mcp_server_instances_project_id_status_idx" ON "mcp_server_instances"("project_id", "status");

-- Foreign keys
ALTER TABLE "mcp_server_instances" ADD CONSTRAINT "mcp_server_instances_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mcp_server_instances" ADD CONSTRAINT "mcp_server_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "mcp_server_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
