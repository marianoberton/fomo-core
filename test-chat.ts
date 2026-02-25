import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    const project = await prisma.project.findFirst();
    if (!project) throw new Error('No project');

    const config = project.configJson as any;
    config.provider = { provider: 'openai', model: 'gpt-4o-mini', apiKeyEnvVar: 'OPENAI_API_KEY' };

    // also allow the tools explicitly
    config.allowedTools = ['send-email', 'knowledge-search'];

    await prisma.project.update({
        where: { id: project.id },
        data: { configJson: config }
    });

    console.log('Provider updated to OpenAI with apiKeyEnvVar');

    const response = await fetch('http://localhost:3002/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            projectId: project.id,
            message: 'You MUST use the send-email tool right now to email mariano@example.com. Do not ask for permission, just do it.',
        })
    });

    const text = await response.text();
    console.log('Response:', text);
    await prisma.$disconnect();
}
main().catch(console.error);
