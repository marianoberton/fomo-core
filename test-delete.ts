import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        await prisma.project.delete({ where: { id: 'gY4OjthxnCmWd7aMZwvsZ' } });
        console.log('Deleted successfully');
    } catch (err) {
        console.error('Delete failed:', err);
    }
    await prisma.$disconnect();
}
main().catch(console.error);
