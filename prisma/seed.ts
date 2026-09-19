import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Admin2026#Hyperion', 10);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@hyperion.com' },
    update: {},
    create: {
      email: 'admin@hyperion.com',
      passwordHash,
      fullName: 'Administrador Hyperion',
      docType: 'DNI',
      docNumber: '75900183',
      role: 'ADMIN',
    },
  });

  console.log('Usuario inicial registrado con éxito:', adminUser.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });