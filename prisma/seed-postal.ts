import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient() as any;

async function main() {
  console.log('🌱 Poblando la tabla de Códigos Postales en PostgreSQL...');

  const filePath = path.join(__dirname, 'codigo.txt');
  if (!fs.existsSync(filePath)) {
    throw new Error(`No se encontró el archivo codigo.txt en: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const records: Array<{
    code: string;
    districts: string;
    province: string;
    department: string;
  }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Codigo')) continue;

    const parts = trimmed.split('\t').map((p) => p.trim());
    if (parts.length >= 5) {
      const code = parts[0];
      if (code && code.length === 5) {
        records.push({
          code,
          districts: parts[2] || parts[1],
          province: parts[3],
          department: parts[4],
        });
      }
    }
  }

  console.log(`📦 Insertando ${records.length} códigos postales...`);

  await prisma.postalCode.deleteMany();

  const chunkSize = 500;
  for (let i = 0; i < records.length; i += chunkSize) {
    await prisma.postalCode.createMany({
      data: records.slice(i, i + chunkSize),
    });
  }

  console.log('✅ ¡Códigos Postales importados con éxito!');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());