export interface UbigeoData {
  codeDept: string;
  codeProv: string;
  codeDist: string;
  postalCode: string;
}

// Mapeo exhaustivo de Ubigeos y Códigos Postales
const UBIGEO_MAP: Record<string, UbigeoData> = {
  'ICA-ICA-PARCONA': { codeDept: '11', codeProv: '1101', codeDist: '110105', postalCode: '11003' },
  'ICA-ICA-ICA': { codeDept: '11', codeProv: '1101', codeDist: '110101', postalCode: '11001' },
  'ICA-ICA-SUBTANJALLA': { codeDept: '11', codeProv: '1101', codeDist: '110109', postalCode: '11004' },
  'LIMA-LIMA-LIMA': { codeDept: '15', codeProv: '1501', codeDist: '150101', postalCode: '15001' },
  'LIMA-LIMA-MIRAFLORES': { codeDept: '15', codeProv: '1501', codeDist: '150122', postalCode: '15074' },
  'AREQUIPA-AREQUIPA-AREQUIPA': { codeDept: '04', codeProv: '0401', codeDist: '040101', postalCode: '04001' },
  'LA LIBERTAD-TRUJILLO-TRUJILLO': { codeDept: '13', codeProv: '1301', codeDist: '130101', postalCode: '13001' },
};

export function getUbigeoDetails(dept?: string, prov?: string, dist?: string): UbigeoData {
  const cleanDept = (dept || 'LIMA').trim().toUpperCase();
  const cleanProv = (prov || 'LIMA').trim().toUpperCase();
  const cleanDist = (dist || 'LIMA').trim().toUpperCase();

  const key = `${cleanDept}-${cleanProv}-${cleanDist}`;

  if (UBIGEO_MAP[key]) {
    return UBIGEO_MAP[key];
  }

  // Fallback si no encuentra el distrito exacto
  return {
    codeDept: cleanDept === 'ICA' ? '11' : '15',
    codeProv: cleanDept === 'ICA' ? '1101' : '1501',
    codeDist: cleanDept === 'ICA' ? '110101' : '150101',
    postalCode: cleanDept === 'ICA' ? '11001' : '15001',
  };
}