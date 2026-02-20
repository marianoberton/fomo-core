-- Add modes column to agents table (AgentMode[] JSON)
ALTER TABLE "agents" ADD COLUMN "modes" JSONB;

-- Add role column to contacts table ('customer' | 'owner' | null)
ALTER TABLE "contacts" ADD COLUMN "role" TEXT;
