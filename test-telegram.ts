import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createProjectRepository, createSessionRepository, createPromptLayerRepository } from '@/infrastructure/repositories/index.js';
import { createToolRegistry } from '@/tools/registry/tool-registry.js';
import { createMCPManager } from '@/mcp/mcp-manager.js';
import { createLogger } from '@/observability/logger.js';
import { prepareChatRun } from '@/api/routes/chat-setup.js';

const prisma = new PrismaClient();
const logger = createLogger();

const PROJECT_ID = 'J2nhYvqO8_DZFZ5K7fwPB';
const SESSION_ID = '5F3FNLG8tOz8ZGSpKenqQ';

const deps = {
  projectRepository: createProjectRepository(prisma),
  sessionRepository: createSessionRepository(prisma),
  promptLayerRepository: createPromptLayerRepository(prisma),
  toolRegistry: createToolRegistry({}),
  mcpManager: createMCPManager(),
  longTermMemoryStore: null,
  prisma,
  logger,
};

console.log('Testing prepareChatRun with resume params...');

const result = await prepareChatRun(
  {
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    message: '[Respuesta del gerente: APROBADO] Informa al cliente sobre la decisión.',
  },
  deps,
);

if (!result.ok) {
  console.error('SETUP FAILED:', result.error.code, '-', result.error.message);
} else {
  console.log('SETUP OK!');
  console.log('  sessionId:', result.value.sessionId);
  console.log('  systemPrompt length:', result.value.systemPrompt.length);
  console.log('  history messages:', result.value.conversationHistory.length);
}

await prisma.$disconnect();
