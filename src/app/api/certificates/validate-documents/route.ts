import { NextResponse } from 'next/server';

interface ValidationRequest {
  formData: {
    ruc?: string;
    dni?: string;
    razonSocial?: string;
    representanteLegal?: string;
  };
  extractedData: Array<{
    documentType: string;
    fileName: string;
    extractedFields: {
      ruc?: string;
      dni?: string;
      razonSocial?: string;
      representanteLegal?: string;
    };
  }>;
}

export async function POST(req: Request) {
  try {
    const body: ValidationRequest = await req.json();
    const { formData, extractedData } = body;

    const errors: Array<{
      field: string;
      documentType: string;
      fileName: string;
      expectedValue: string;
      extractedValue: string;
      message: string;
    }> = [];

    if (!extractedData || !Array.isArray(extractedData)) {
      return NextResponse.json(
        { valid: true, errors: [] },
        { status: 200 }
      );
    }

    extractedData.forEach((doc) => {
      const { documentType, fileName, extractedFields } = doc;

      if (!extractedFields) return;

      // 1. Validar RUC
      if (formData.ruc && extractedFields.ruc) {
        const cleanFormRuc = formData.ruc.trim();
        const cleanExtractedRuc = extractedFields.ruc.trim();
        if (cleanFormRuc !== cleanExtractedRuc) {
          errors.push({
            field: 'ruc',
            documentType,
            fileName,
            expectedValue: cleanFormRuc,
            extractedValue: cleanExtractedRuc,
            message: `El RUC extraído del archivo "${fileName}" (${cleanExtractedRuc}) no coincide con el RUC ingresado en el formulario (${cleanFormRuc}).`
          });
        }
      }

      // 2. Validar DNI / Documento de Identidad
      if (formData.dni && extractedFields.dni) {
        const cleanFormDni = formData.dni.trim();
        const cleanExtractedDni = extractedFields.dni.trim();
        if (cleanFormDni !== cleanExtractedDni) {
          errors.push({
            field: 'dni',
            documentType,
            fileName,
            expectedValue: cleanFormDni,
            extractedValue: cleanExtractedDni,
            message: `El DNI extraído del archivo "${fileName}" (${cleanExtractedDni}) no coincide con el DNI ingresado (${cleanFormDni}).`
          });
        }
      }

      // 3. Validar Razón Social (búsqueda insensible a caracteres especiales)
      if (formData.razonSocial && extractedFields.razonSocial) {
        const normFormRS = formData.razonSocial.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normExtractedRS = extractedFields.razonSocial.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!normExtractedRS.includes(normFormRS) && !normFormRS.includes(normExtractedRS)) {
          errors.push({
            field: 'razonSocial',
            documentType,
            fileName,
            expectedValue: formData.razonSocial,
            extractedValue: extractedFields.razonSocial,
            message: `La Razón Social en "${fileName}" ("${extractedFields.razonSocial}") no coincide con la información ingresada.`
          });
        }
      }
    });

    if (errors.length > 0) {
      return NextResponse.json({ valid: false, errors }, { status: 400 });
    }

    return NextResponse.json({ valid: true, errors: [] }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      {
        valid: false,
        message: 'Error interno en la validación previa de documentos.',
        error: error.message || String(error)
      },
      { status: 500 }
    );
  }
}