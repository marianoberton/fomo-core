-- Fix existing knowledge entries: rows with agent_id NULL but scope='agent' are
-- knowledge-service entries that should be scope='project' so agents can find them.
UPDATE memory_entries
SET scope = 'project'
WHERE agent_id IS NULL AND scope = 'agent';
