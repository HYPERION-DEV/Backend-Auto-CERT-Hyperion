export interface VerificationValidationInput {
  inputDni: string;
  extractedDni: string;
  extractedExpiryDate?: string; // Opcional pero evaluado si está presente
  fileSizeBytes: number;
  mimeType: string;
}

export interface VerificationValidationResult {
  isValidFormat: boolean;
  isMatch: boolean;
  status: 'EN_REVISION' | 'RECHAZADO';
  progress: string;
  errors: string[];
}

export class CertificateValidator {
  /**
   * Valida formato del DNI peruano (8 dígitos)
   */
  static isValidDniFormat(dni: string): boolean {
    return /^\d{8}$/.test(dni);
  }

  /**
   * Valida restricciones del archivo subido
   */
  static validateFileConstraints(mimeType: string, fileSizeBytes: number): string | null {
    if (mimeType !== 'application/pdf') {
      return 'El documento debe estar en formato PDF.';
    }
    const MAX_SIZE_MB = 10;
    if (fileSizeBytes > MAX_SIZE_MB * 1024 * 1024) {
      return `El archivo supera el tamaño máximo permitido de ${MAX_SIZE_MB}MB.`;
    }
    return null;
  }

  /**
   * Valida si la fecha de caducidad extraída del DNI está vencida con respecto a la fecha actual
   */
  static validateExpiryDate(expiryDateStr?: string): { isExpired: boolean; error?: string } {
    if (!expiryDateStr) {
      return { isExpired: false }; // Si no se detecta la fecha, no bloquea por caducidad (mantiene flujo de revisión)
    }

    // Limpiar caracteres extraños y separar por espacios, guiones o puntos
    const cleanStr = expiryDateStr.replace(/[\/\.-]/g, ' ').trim();
    const parts = cleanStr.split(/\s+/);

    let expiryDate: Date | null = null;

    if (parts.length === 3) {
      // Caso 1: Formato "DD MM YYYY" (ej: "10 11 2025" o "10/11/2025")
      if (parts[2].length === 4) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Meses en JS son 0-11
        const year = parseInt(parts[2], 10);
        expiryDate = new Date(year, month, day, 23, 59, 59);
      }
      // Caso 2: Formato "YYYY MM DD" (ej: "2025 11 10" o "2025-11-10")
      else if (parts[0].length === 4) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        expiryDate = new Date(year, month, day, 23, 59, 59);
      }
    }

    if (!expiryDate || isNaN(expiryDate.getTime())) {
      expiryDate = new Date(expiryDateStr);
    }

    if (isNaN(expiryDate.getTime())) {
      return { isExpired: false };
    }

    const now = new Date();

    // Comparar fecha de vencimiento contra la fecha actual
    if (expiryDate < now) {
      const formattedDate = `${expiryDate.getDate().toString().padStart(2, '0')}/${(expiryDate.getMonth() + 1).toString().padStart(2, '0')}/${expiryDate.getFullYear()}`;
      return {
        isExpired: true,
        error: `Documento Vencido: El DNI presentado caducó el ${formattedDate}. Debe presentar un documento de identidad vigente.`,
      };
    }

    return { isExpired: false };
  }

  /**
   * Evalúa la coincidencia entre el input ingresado, el OCR detectado y la vigencia del documento
   */
  static evaluateDniVerification(input: VerificationValidationInput): VerificationValidationResult {
    const errors: string[] = [];

    if (!this.isValidDniFormat(input.inputDni)) {
      errors.push('El número de DNI debe contener exactamente 8 dígitos numéricos.');
    }

    const fileError = this.validateFileConstraints(input.mimeType, input.fileSizeBytes);
    if (fileError) {
      errors.push(fileError);
    }

    const cleanDetectedDni = input.extractedDni.replace(/\D/g, '');
    const isMatch = cleanDetectedDni !== '' && cleanDetectedDni === input.inputDni;

    if (!isMatch) {
      errors.push(`Inconsistencia: DNI detectado (${cleanDetectedDni || 'No detectado'}) no coincide con el ingresado (${input.inputDni}).`);
    }

    // 🎯 VALIDACIÓN DE VENCIMIENTO DEL DNI
    const expiryValidation = this.validateExpiryDate(input.extractedExpiryDate);
    if (expiryValidation.isExpired && expiryValidation.error) {
      errors.push(expiryValidation.error);
    }

    const hasErrors = errors.length > 0;
    const isSuccess = isMatch && !expiryValidation.isExpired && !hasErrors;

    return {
      isValidFormat: !hasErrors,
      isMatch,
      status: isSuccess ? 'EN_REVISION' : 'RECHAZADO',
      progress: isSuccess ? '1/1' : '0/1',
      errors,
    };
  }

  static isValidRucFormat(ruc: string): { isValid: boolean; message?: string; rucType?: string } {
    if (!/^\d{11}$/.test(ruc)) {
      return { isValid: false, message: 'El RUC debe tener exactamente 11 dígitos numéricos.' };
    }
    if (!ruc.startsWith('10') && !ruc.startsWith('20')) {
      return { isValid: false, message: 'El RUC debe iniciar obligatoriamente con 10 o 20.' };
    }
    return {
      isValid: true,
      rucType: ruc.startsWith('20') ? 'Persona Jurídica' : 'Persona Natural con Negocio',
    };
  }
}