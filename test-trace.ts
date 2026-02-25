import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    const trace = await prisma.executionTrace.findFirst({
        orderBy: { createdAt: 'desc' }
    });
    console.log(JSON.stringify(trace, null, 2));
    await prisma.$disconnect();
}
main().catch(console.error);
