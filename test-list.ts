import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    const projects = await prisma.project.findMany();
    console.log(projects.map(p => ({ id: p.id, name: p.name })));
    await prisma.$disconnect();
}
main().catch(console.error);
