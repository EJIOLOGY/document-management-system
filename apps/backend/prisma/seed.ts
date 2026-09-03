import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.SEED_HOB_EMAIL;
  const password = process.env.SEED_HOB_PASSWORD;
  const name = process.env.SEED_HOB_NAME ?? 'Head of Bidding';

  if (!email || !password) {
    throw new Error(
      'SEED_HOB_EMAIL and SEED_HOB_PASSWORD must be set in .env before seeding.',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Head of Bidding account already exists (${email}), skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: Role.HEAD_OF_BIDDING,
      active: true,
    },
  });

  console.log(`Head of Bidding account created: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
