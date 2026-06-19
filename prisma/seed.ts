import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  const testUser = await prisma.user.upsert({
    where: { jid: 'test@example.com' },
    update: {},
    create: {
      jid: 'test@example.com',
      name: 'Test User',
      economy: {
        create: {
          wallet: 1000,
          bank: 5000,
        },
      },
      levels: {
        create: {
          level: 5,
          xp: 2500,
        },
      },
    },
  });

  console.log('Created test user:', testUser);

  const testStickerPack = await prisma.stickerPack.create({
    data: {
      name: 'Test Pack',
      author: 'WhatsApp Hybrid Bot',
      stickerCount: 10,
    },
  });

  console.log('Created test sticker pack:', testStickerPack);

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
