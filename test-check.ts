import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const s = await p.session.findUnique({ where: { id: '5F3FNLG8tOz8ZGSpKenqQ' } });
console.log('metadata:', JSON.stringify(s?.metadata));
await p.$disconnect();
