/**
 * Migration script: update existing Fomo project config.
 *
 * Updates allowedTools and enables long-term memory for existing projects.
 * Run: npx tsx prisma/fix-allowed-tools.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    console.log('Updating project configs...\n');

    // Find all projects owned by Fomo
    const projects = await prisma.project.findMany({
        where: {
            OR: [
                { owner: { contains: 'fomo', mode: 'insensitive' } },
                { owner: { contains: 'mariano', mode: 'insensitive' } },
                { name: { contains: 'fomo', mode: 'insensitive' } },
            ],
        },
    });

    if (projects.length === 0) {
        // Update ALL projects if no Fomo-specific ones found
        const all = await prisma.project.findMany();
        projects.push(...all);
    }

    const newAllowedTools = [
        'calculator', 'date-time', 'json-transform',
        'knowledge-search', 'read-file', 'send-email',
        'send-notification', 'http-request', 'web-search',
        'propose-scheduled-task',
    ];

    let updated = 0;

    for (const project of projects) {
        const config = project.configJson as Record<string, unknown> | null;
        if (!config) {
            console.log(`  Skipping ${project.id} (${project.name}) — no config`);
            continue;
        }

        // Update allowedTools
        config['allowedTools'] = newAllowedTools;

        // Enable long-term memory
        const memoryConfig = config['memoryConfig'] as Record<string, unknown> | undefined;
        if (memoryConfig) {
            const longTerm = memoryConfig['longTerm'] as Record<string, unknown> | undefined;
            if (longTerm) {
                longTerm['enabled'] = true;
            }
        }

        await prisma.project.update({
            where: { id: project.id },
            data: { configJson: config as unknown as import('@prisma/client').Prisma.InputJsonValue },
        });

        console.log(`  ✅ Updated: ${project.id} (${project.name})`);
        console.log(`     allowedTools: [${newAllowedTools.join(', ')}]`);
        console.log(`     longTerm.enabled: true`);
        updated++;
    }

    console.log(`\nDone! Updated ${updated} project(s).`);
}

main()
    .catch((e: unknown) => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(() => {
        void prisma.$disconnect();
    });
