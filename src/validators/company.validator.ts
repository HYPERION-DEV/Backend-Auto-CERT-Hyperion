// backend-hyperion/src/validators/company.validator.ts

export interface FormCompanyInput {
  rucIngresado?: string;
  empresaIngresada: string; // Nombre o Razón Social
  dniRepresentante: string;
}

export interface OcrDniData {
  dniDetectado: string;
  fechaCaducidad?: string; // Formato YYYY-MM-DD
}

export interface OcrFichaRucData {
  rucDetectado: string;
  razonSocial: string;
  estadoContribuyente: string; // "ACTIVO"
  condicionContribuyente: string; // "HABIDO"
  dnisRepresentantesLegales: string[]; // Lista de DNI listados en Ficha RUC
}

export interface OcrVigenciaPoderData {
  razonSocial: string;
  dnisApoderadosVigentes: string[]; // DNI del apoderado
  fechaEmisionSunarp: string; // Formato YYYY-MM-DD
}

export interface CrossValidationResult {
  isValid: boolean;
  status: 'EN_REVISION' | 'RECHAZADO';
  rejectionReasons: string[];
}

export class CompanyCrossValidator {
  /**
   * Algoritmo Levenshtein para calcular la similitud entre dos cadenas de texto (0 a 1)
   */
  private static calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const s2 = str2.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    const track = Array(s2.length + 1).fill(null).map(() =>
      Array(s1.length + 1).fill(null)
    );

    for (let i = 0; i <= s1.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= s2.length; j += 1) track[j][0] = j;

    for (let j = 1; j <= s2.length; j += 1) {
      for (let i = 1; i <= s1.length; i += 1) {
        const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1, // inserción
          track[j - 1][i] + 1, // eliminación
          track[j - 1][i - 1] + indicator // sustitución
        );
      }
    }

    const distance = track[s2.length][s1.length];
    const maxLength = Math.max(s1.length, s2.length);
    return (maxLength - distance) / maxLength;
  }

  /**
   * Matriz de Validación Cruzada Cruzada Multidocumento
   */
  static validate(
    form: FormCompanyInput,
    dniOcr: OcrDniData,
    rucOcr: OcrFichaRucData,
    vigenciaOcr: OcrVigenciaPoderData
  ): CrossValidationResult {
    const reasons: string[] = [];

    // ==========================================
    // REGLA A: Validación de la Entidad (Empresa)
    // ==========================================
    if (form.rucIngresado && form.rucIngresado.trim() !== '') {
      if (form.rucIngresado.trim() !== rucOcr.rucDetectado.trim()) {
        reasons.push(
          `El RUC ingresado (${form.rucIngresado}) no coincide exactamente con el RUC extraído de la Ficha RUC (${rucOcr.rucDetectado}).`
        );
      }
    } else {
      // Si NO se ingresó RUC: Similitud de texto difusa (>85%) entre Formulario, Ficha RUC y Vigencia
      const simFormRuc = this.calculateSimilarity(form.empresaIngresada, rucOcr.razonSocial);
      if (simFormRuc < 0.85) {
        reasons.push(
          `La razón social ingresada ("${form.empresaIngresada}") difiere de la Ficha RUC ("${rucOcr.razonSocial}"). Similitud: ${(simFormRuc * 100).toFixed(1)}% (Mínimo 85%).`
        );
      }

      const simFormVigencia = this.calculateSimilarity(form.empresaIngresada, vigenciaOcr.razonSocial);
      if (simFormVigencia < 0.85) {
        reasons.push(
          `La razón social ingresada ("${form.empresaIngresada}") difiere de la Vigencia de Poder ("${vigenciaOcr.razonSocial}"). Similitud: ${(simFormVigencia * 100).toFixed(1)}% (Mínimo 85%).`
        );
      }
    }

    // Coincidencia entre Razón Social de Ficha RUC y Vigencia de Poder
    const simRucVigencia = this.calculateSimilarity(rucOcr.razonSocial, vigenciaOcr.razonSocial);
    if (simRucVigencia < 0.85) {
      reasons.push(
        `Inconsistencia entre documentos: La Razón Social en Ficha RUC ("${rucOcr.razonSocial}") no coincide con Vigencia de Poder ("${vigenciaOcr.razonSocial}").`
      );
    }

    // ==========================================
    // REGLA B: Validación de Identidad del Rep. Legal (Llave Maestra: DNI)
    // ==========================================
    const masterDni = form.dniRepresentante.trim();

    // 1. Frente a DNI Físico
    if (masterDni !== dniOcr.dniDetectado.trim()) {
      reasons.push(
        `El DNI del Representante (${masterDni}) no coincide con el número extraído del DNI físico (${dniOcr.dniDetectado}).`
      );
    }

    // 2. Frente a Representantes Legales en Ficha RUC
    const inFichaRuc = rucOcr.dnisRepresentantesLegales.some((d) => d.trim() === masterDni);
    if (!inFichaRuc) {
      reasons.push(
        `El DNI (${masterDni}) no figura en la lista de Representantes Legales de la Ficha RUC.`
      );
    }

    // 3. Frente a Apoderados en Vigencia de Poder
    const inVigencia = vigenciaOcr.dnisApoderadosVigentes.some((d) => d.trim() === masterDni);
    if (!inVigencia) {
      reasons.push(
        `El DNI (${masterDni}) no aparece como apoderado registrado dentro de la Vigencia de Poder SUNARP.`
      );
    }

    // ==========================================
    // REGLA C: Validación de Estados y Vigencias
    // ==========================================
    
    // C1: Estado Ficha RUC (ACTIVO y HABIDO)
    if (rucOcr.estadoContribuyente.toUpperCase() !== 'ACTIVO') {
      reasons.push(`El estado de la empresa en SUNAT es "${rucOcr.estadoContribuyente}"; debe ser estrictamente ACTIVO.`);
    }
    if (rucOcr.condicionContribuyente.toUpperCase() !== 'HABIDO') {
      reasons.push(`La condición del contribuyente en SUNAT es "${rucOcr.condicionContribuyente}"; debe ser estrictamente HABIDO.`);
    }

    // C2: Vigencia de DNI (Caducidad > Fecha Actual)
    if (dniOcr.fechaCaducidad) {
      const expiryDate = new Date(dniOcr.fechaCaducidad);
      const today = new Date();
      if (expiryDate < today) {
        reasons.push(`El DNI del Representante Legal se encuentra caducado (Fecha de vencimiento: ${dniOcr.fechaCaducidad}).`);
      }
    }

    // C3: Antigüedad de Vigencia de Poder SUNARP (≤ 30 días calendario)
    if (vigenciaOcr.fechaEmisionSunarp) {
      const issueDate = new Date(vigenciaOcr.fechaEmisionSunarp);
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - issueDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays > 30) {
        reasons.push(
          `La Vigencia de Poder SUNARP ha superado el límite de 30 días de antigüedad (Fecha emisión: ${vigenciaOcr.fechaEmisionSunarp}, Antigüedad: ${diffDays} días).`
        );
      }
    } else {
      reasons.push('No se pudo determinar la fecha de emisión del Certificado de Vigencia de Poder.');
    }

    const isValid = reasons.length === 0;

    return {
      isValid,
      status: isValid ? 'EN_REVISION' : 'RECHAZADO',
      rejectionReasons: reasons,
    };
  }
}