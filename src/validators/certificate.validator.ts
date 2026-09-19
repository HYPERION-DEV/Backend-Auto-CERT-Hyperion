export interface VerificationValidationInput {
  inputDni: string;
  extractedDni: string;
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
   * Evalúa la coincidencia entre el input ingresado y el OCR detectado
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

    return {
      isValidFormat: errors.length === 0,
      isMatch,
      status: isMatch ? 'EN_REVISION' : 'RECHAZADO',
      progress: isMatch ? '1/1' : '0/1',
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