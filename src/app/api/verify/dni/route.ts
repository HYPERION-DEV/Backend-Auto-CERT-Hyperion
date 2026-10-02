import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient, EntityType, DocType, DocumentCategory, RequestStatus } from '@prisma/client';
import { CertificateValidator } from '@/validators/certificate.validator';
import { uploadToSupabase } from '@/lib/supabase';
import { LocationService } from '@/lib/ubigeo-service';

const prisma = new PrismaClient();
const apiKey = process.env.GEMINI_API_KEY || '';

// Schema DNI ampliado con fecha de caducidad
const dniResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    documentoDetectado: { type: Type.BOOLEAN },
    cuiDni: { type: Type.STRING, description: 'Número de DNI de 8 dígitos' },
    nombres: { type: Type.STRING },
    primerApellido: { type: Type.STRING },
    segundoApellido: { type: Type.STRING },
    fechaNacimiento: { type: Type.STRING, description: 'Formato DD/MM/AAAA' },
    fechaCaducidad: { type: Type.STRING, description: 'Fecha de caducidad/vencimiento impresa en el DNI en formato YYYY-MM-DD o DD/MM/YYYY' },
    nacionalidad: { type: Type.STRING },
    departamento: { type: Type.STRING, description: 'Departamento según el DNI' },
    provincia: { type: Type.STRING, description: 'Provincia según el DNI' },
    distrito: { type: Type.STRING, description: 'Distrito según el DNI' },
    direccion: { type: Type.STRING, description: 'Dirección o domicilio completo impreso' },
  },
  required: ['documentoDetectado', 'cuiDni', 'nombres', 'primerApellido', 'segundoApellido'],
};

// Función auxiliar para parsear y validar la fecha de caducidad
function checkDniExpiration(fechaCaducidadStr?: string): { isExpired: boolean; dateFormatted?: string } {
  if (!fechaCaducidadStr) return { isExpired: false };

  try {
    let expDate: Date;

    // Manejo de formatos YYYY-MM-DD o DD/MM/YYYY
    if (fechaCaducidadStr.includes('-')) {
      const parts = fechaCaducidadStr.split('-');
      if (parts[0].length === 4) {
        expDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      } else {
        expDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    } else if (fechaCaducidadStr.includes('/')) {
      const parts = fechaCaducidadStr.split('/');
      if (parts[2].length === 4) {
        expDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else {
        expDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      }
    } else {
      return { isExpired: false };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isExpired = expDate < today;
    const dateFormatted = expDate.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return { isExpired, dateFormatted };
  } catch (e) {
    return { isExpired: false };
  }
}

async function processDniWithAi(ai: GoogleGenAI, base64Pdf: string) {
  const models = ['gemini-3.6-flash', 'gemini-3.5-flash'];
  const errors: string[] = [];

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
          { text: 'Extrae con precisión los datos del DNI: CUI/DNI (8 dígitos), nombres, primer apellido, segundo apellido, fecha de nacimiento, fecha de caducidad/vencimiento, nacionalidad, departamento, provincia, distrito y dirección completa.' },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: dniResponseSchema,
          temperature: 0.0,
        },
      });

      if (response && response.text) return response;
    } catch (error: any) {
      errors.push(`[${model}]: ${error?.message || error?.toString()}`);
    }
  }

  throw new Error(`Fallo en el procesamiento OCR con la API de IA. Detalle: ${errors.join(' | ')}`);
}

export async function POST(request: NextRequest) {
  try {
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY no configurada.' }, { status: 500 });
    }

    const formData = await request.formData();

    const fileDni = formData.get('file') as File;
    const inputDni = ((formData.get('documentNumber') as string) || '').trim();
    const applicantEmail = ((formData.get('email') as string) || '').trim();
    const applicantPhone = ((formData.get('phone') as string) || '').trim();
    const planType = ((formData.get('planType') as string) || 'ONE_SHOT').trim();

    if (!fileDni || !inputDni || !applicantEmail || !applicantPhone) {
      return NextResponse.json({ error: 'Faltan datos obligatorios del titular.' }, { status: 400 });
    }

    // 1. Subida directa a Supabase Storage y extracción OCR
    const dniSaved = await uploadToSupabase(fileDni, `verifications/dni/${inputDni}`);
    const ai = new GoogleGenAI({ apiKey });
    const aiResponse = await processDniWithAi(ai, dniSaved.buffer.toString('base64'));

    const extractedData = JSON.parse(aiResponse.text || '{}');
    const detectedDni = (extractedData.cuiDni || '').replace(/\D/g, '');

    // 🎯 2. VALIDADOR DE CADUCIDAD
    const expirationCheck = checkDniExpiration(extractedData.fechaCaducidad);

    if (expirationCheck.isExpired) {
      return NextResponse.json(
        {
          success: false,
          error: `El Documento de Identidad (DNI) adjunto se encuentra VENCIDO desde el ${expirationCheck.dateFormatted}. Debe adjuntar un DNI vigente para continuar.`,
          code: 'DNI_EXPIRED',
        },
        { status: 400 }
      );
    }

    // 3. Evaluar coincidencia de DNI con validador de negocio
    const validation = CertificateValidator.evaluateDniVerification({
      inputDni,
      extractedDni: detectedDni,
      fileSizeBytes: dniSaved.buffer.length,
      mimeType: fileDni.type || 'application/pdf',
    });

    // ⛔ ESTE ES EL BLOQUEO QUE FALTABA: Si no coinciden los datos o la validación falla, no creamos en la BD.
    if (!validation.isMatch || !validation.isValidFormat) {
      const errorMessage = validation.errors.length > 0
        ? validation.errors.join(' | ')
        : 'El documento adjunto no coincide con el DNI ingresado.';

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          validation,
        },
        { status: 400 } // Retornamos 400 para que el Frontend muestre el error y NO guarde nada.
      );
    }

    const defaultUser = await prisma.user.findFirst();
    if (!defaultUser) {
      return NextResponse.json({ error: 'No existe usuario base registrado.' }, { status: 500 });
    }

    // 4. Resolver Ubicación y Código Postal
    const rawDept = extractedData.departamento || 'ICA';
    const rawProv = extractedData.provincia || 'ICA';
    const rawDist = extractedData.distrito || 'PARCONA';
    const location = await LocationService.resolveLocationAndZip(rawDept, rawProv, rawDist);

    // 5. Mapear Documentos
    const documentsToCreate: any[] = [
      {
        category: DocumentCategory.DNI_FRONT_BACK,
        fileName: fileDni.name,
        fileUrl: dniSaved.fileUrl,
        storagePath: dniSaved.storagePath,
        mimeType: fileDni.type || 'application/pdf',
        fileSizeBytes: dniSaved.buffer.length,
        verificationResult: {
          create: {
            isMatch: validation.isMatch,
            inputDocumentNum: inputDni,
            detectedDocumentNum: detectedDni,
            extractedNames: extractedData.nombres,
            extractedSurname1: extractedData.primerApellido,
            extractedSurname2: extractedData.segundoApellido,
            extractedBirthDate: extractedData.fechaNacimiento,
            extractedNationality: extractedData.nacionalidad,
            extractedDepartment: location.department,
            extractedProvince: location.province,
            extractedDistrict: location.district,
            extractedAddress: extractedData.direccion,
            rawAiJsonResponse: extractedData,
          },
        },
      },
    ];

    const certCode = `CERT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const certRequest = await prisma.certificateRequest.create({
      data: {
        code: certCode,
        userId: defaultUser.id,
        entityType: EntityType.PERSONA_NATURAL,
        planType,
        status: validation.status,
        progress: validation.progress,
        applicantDocType: DocType.DNI,
        applicantDocNum: inputDni,
        applicantNames: validation.isMatch ? (extractedData.nombres || 'NO DETECTADO') : 'DOCUMENTO NO COINCIDE',
        applicantSurname1: validation.isMatch ? (extractedData.primerApellido || '') : 'PENDIENTE DE REEMPLAZO',
        applicantSurname2: validation.isMatch ? (extractedData.segundoApellido || '') : '',
        applicantEmail,
        applicantPhone,

        department: location.department,
        province: location.province,
        district: location.district,
        address: extractedData.direccion || null,
        postalCode: location.postalCode,
        documents: {
          create: documentsToCreate,
        },
      },
      include: {
        documents: {
          include: { verificationResult: true },
        },
      },
    });

    return NextResponse.json({ success: true, validation, data: certRequest });

  } catch (error: any) {
    console.error('Error durante el procesamiento backend:', error);
    return NextResponse.json({ error: error?.message || 'Error interno del servidor.' }, { status: 500 });
  }
}