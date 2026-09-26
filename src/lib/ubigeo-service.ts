import { prisma } from '@/lib/prisma'; // 👈 Usar el singleton de Prisma del proyecto

function normalize(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

export class LocationService {
  /**
   * Resuelve Departamento, Provincia, Distrito y busca el Código Postal de 5 dígitos.
   */
  static async resolveLocationAndZip(department: string, province: string, district: string) {
    const deptClean = normalize(department);
    const provClean = normalize(province);
    const distClean = normalize(district);

    let resDept = deptClean || 'ICA';
    let resProv = provClean || 'ICA';
    let resDist = distClean || 'PARCONA';
    let uMatch: any = null;

    // 1. Buscar en Ubigeo
    try {
      const ubigeoModel = (prisma as any).ubigeo || (prisma as any).Ubigeo;
      if (ubigeoModel) {
        uMatch = await ubigeoModel.findFirst({
          where: {
            department: { equals: deptClean, mode: 'insensitive' },
            province: { equals: provClean, mode: 'insensitive' },
            district: { equals: distClean, mode: 'insensitive' },
          },
        });

        if (!uMatch) {
          uMatch = await ubigeoModel.findFirst({
            where: {
              department: { contains: deptClean, mode: 'insensitive' },
              province: { contains: provClean, mode: 'insensitive' },
              district: { contains: distClean, mode: 'insensitive' },
            },
          });
        }
      }
    } catch (err) {
      console.warn('⚠️ [LocationService] No se pudo consultar la tabla Ubigeo:', err);
    }

    if (uMatch) {
      resDept = uMatch.department;
      resProv = uMatch.province;
      resDist = uMatch.district;
    }

    // 2. Buscar el Código Postal en PostalCode
    let realZip = '11003'; // CP por defecto (Parcona / Ica)
    try {
      const postalModel = (prisma as any).postalCode || (prisma as any).PostalCode;
      if (postalModel) {
        let pMatch = await postalModel.findFirst({
          where: {
            department: { equals: resDept, mode: 'insensitive' },
            province: { equals: resProv, mode: 'insensitive' },
            districts: { contains: resDist, mode: 'insensitive' },
          },
        });

        if (!pMatch) {
          pMatch = await postalModel.findFirst({
            where: {
              department: { equals: resDept, mode: 'insensitive' },
              province: { equals: resProv, mode: 'insensitive' },
            },
          });
        }

        if (pMatch) {
          realZip = pMatch.code;
        }
      }
    } catch (err) {
      console.warn('⚠️ [LocationService] No se pudo consultar la tabla PostalCode:', err);
    }

    return {
      ubigeoCode: uMatch ? uMatch.code : '110106',
      department: resDept,
      province: resProv,
      district: resDist,
      postalCode: realZip,
    };
  }
}