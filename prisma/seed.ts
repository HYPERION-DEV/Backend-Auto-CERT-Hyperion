import { PrismaClient, Role, DocType } from '@prisma/client';
import * as bcrypt from 'bcryptjs'; // O la librería de hash que utilices en tu proyecto

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando la siembra de la base de datos (seeding)...');

  // Encriptar la contraseña para el Administrador Principal
  const passwordHash = await bcrypt.hash('TuPasswordSeguro123!', 10);

  // Utilizar 'upsert' para crear el usuario si no existe, o mantenerlo si ya existe
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@hyperion.com.pe' },
    update: {
      role: Role.ADMIN,
      isActive: true,
    },
    create: {
      email: 'admin@hyperion.com.pe',
      passwordHash: passwordHash,
      fullName: 'Administrador Principal Hyperion',
      docType: DocType.DNI,
      docNumber: '00000000',
      phone: '999999999',
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log(`✅ Usuario Administrador registrado/verificado: ${adminUser.email}`);
}

main()
  .catch((e) => {
    console.error('💥 Error durante el seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });