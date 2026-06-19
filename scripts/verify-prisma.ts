import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Testing Prisma connection...');
  
  const users = await prisma.user.findMany({ take: 1 });
  console.log(`✅ Connected. Found ${users.length} user(s) in the database.`);
}

main()
  .catch((e) => {
    console.error('❌ Connection failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
