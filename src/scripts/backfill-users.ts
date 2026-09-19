// backend-hyperion/src/scripts/backfill-users.ts

import { PrismaClient, EntityType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Iniciando migración de usuarios existentes...');

  // 1. Obtener todas las solicitudes registradas previamente
  const existingRequests = await prisma.certificateRequest.findMany();

  console.log(`📋 Se encontraron ${existingRequests.length} solicitudes en la base de datos.`);

  let insertedCount = 0;

  for (const req of existingRequests) {
    if (!req.applicantDocNum) continue;

    const dni = req.applicantDocNum.trim();
    const firstNames = (req.applicantNames || 'TITULAR').trim().toUpperCase();
    
    const surname1 = (req.applicantSurname1 || '').trim();
    const surname2 = (req.applicantSurname2 || '').trim();
    const lastNames = `${surname1} ${surname2}`.trim().toUpperCase();
    
    const fullName = `${firstNames} ${lastNames}`.trim().toUpperCase();

    // Evitar duplicados si el DNI ya existe en la tabla de verificación
    const exists = await prisma.verificationRequest.findFirst({
      where: { documentNumber: dni },
    });

    if (!exists) {
      await prisma.verificationRequest.create({
        data: {
          userId: req.userId,
          entityType: req.entityType,
          documentNumber: dni,
          extractedFirstName: firstNames,
          extractedLastName: lastNames || 'SIN APELLIDO',
          extractedFullName: fullName,
          email: req.applicantEmail || null,
          phone: req.applicantPhone || null,
          companyRuc: req.companyRuc || null,
          companyName: req.companyName || null,
          isVerified: true,
        },
      });
      insertedCount++;
    }
  }

  console.log(`✅ Migración completada. Se registraron ${insertedCount} usuarios en la base de datos de exportación.`);
}

main()
  .catch((e) => {
    console.error('❌ Error durante la migración:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });