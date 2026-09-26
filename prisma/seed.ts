import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient() as any; // Bypass temporal de caché del cliente TS

async function main() {
  console.log('🌱 Poblando la tabla de Ubigeos en PostgreSQL...');

  const filePath = path.join(__dirname, 'ubigeo.txt');
  if (!fs.existsSync(filePath)) {
    throw new Error(`No se encontró el archivo ubigeo.txt en: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const records: Array<{
    code: string;
    district: string;
    province: string;
    department: string;
    population: number | null;
    surfaceArea: number | null;
  }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Ubigeo')) continue;

    const parts = trimmed.split('\t').map((p) => p.trim());
    if (parts.length >= 4) {
      const code = parts[0];
      if (code && code.length === 6) {
        records.push({
          code,
          district: parts[1],
          province: parts[2],
          department: parts[3],
          population: parts[4] ? parseInt(parts[4], 10) || null : null,
          surfaceArea: parts[5] ? parseFloat(parts[5]) || null : null,
        });
      }
    }
  }

  console.log(`📦 Se encontraron ${records.length} registros. Insertando en lotes...`);

  await prisma.ubigeo.deleteMany();

  const chunkSize = 500;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    await prisma.ubigeo.createMany({
      data: chunk,
      skipDuplicates: true,
    });
  }

  console.log('✅ ¡Ubigeos importados correctamente en la Base de Datos!');
}

main()
  .catch((e) => {
    console.error('❌ Error durante la importación:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });