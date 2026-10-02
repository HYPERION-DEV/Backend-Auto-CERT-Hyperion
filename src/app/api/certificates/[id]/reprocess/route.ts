import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient, DocumentCategory } from '@prisma/client';
import { CertificateValidator } from '@/validators/certificate.validator';
import { LocationService } from '@/lib/ubigeo-service';

const prisma = new PrismaClient() as any;
const apiKey = process.env.GEMINI_API_KEY || '';

// 🎯 Schema DNI ampliado con fecha de caducidad
const dniResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    documentoDetectado: { type: Type.BOOLEAN },
    cuiDni: { type: Type.STRING },
    nombres: { type: Type.STRING },
    primerApellido: { type: Type.STRING },
    segundoApellido: { type: Type.STRING },
    fechaNacimiento: { type: Type.STRING },
    fechaCaducidad: { type: Type.STRING, description: 'Fecha de caducidad/vencimiento en formato YYYY-MM-DD o DD/MM/YYYY' },
    nacionalidad: { type: Type.STRING },
    departamento: { type: Type.STRING },
    provincia: { type: Type.STRING },
    distrito: { type: Type.STRING },
    direccion: { type: Type.STRING },
  },
  required: ['documentoDetectado', 'cuiDni', 'nombres', 'primerApellido', 'segundoApellido'],
};

// 🎯 Función auxiliar para validar la fecha de caducidad
function checkDniExpiration(fechaCaducidadStr?: string): { isExpired: boolean; dateFormatted?: string } {
  if (!fechaCaducidadStr) return { isExpired: false };

  try {
    let expDate: Date;

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // 1. ESPERAR A LOS PARAMS (Compatibilidad Next.js App Router)
    const resolvedParams = await params;
    const requestId = resolvedParams.id;

    if (!requestId) {
      return NextResponse.json({ error: 'ID de solicitud no proporcionado.' }, { status: 400 });
    }

    // Modelo seguro de Prisma
    const certModel = prisma.certificateRequest || prisma.CertificateRequest;

    // 2. Obtener la solicitud y el documento cargado
    const certRequest = await certModel.findUnique({
      where: { id: requestId },
      include: {
        documents: {
          include: { verificationResult: true },
        },
      },
    });

    if (!certRequest) {
      return NextResponse.json({ error: 'Solicitud no encontrada en la base de datos.' }, { status: 404 });
    }

    const dniDoc = certRequest.documents.find((d: any) => d.category === DocumentCategory.DNI_FRONT_BACK);
    if (!dniDoc || !dniDoc.fileUrl) {
      return NextResponse.json({ error: 'No se encontró el PDF cargado para este certificado.' }, { status: 400 });
    }

    // 3. Descargar el PDF almacenado desde Supabase
    const pdfResponse = await fetch(dniDoc.fileUrl);
    if (!pdfResponse.ok) {
      return NextResponse.json({ error: 'No se pudo descargar el PDF desde Supabase.' }, { status: 400 });
    }
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const base64Pdf = Buffer.from(pdfBuffer).toString('base64');

    // 4. Re-procesar OCR con Gemini AI
    const ai = new GoogleGenAI({ apiKey });
    const models = ['gemini-3.6-flash', 'gemini-3.5-flash'];
    let aiResponseText = '';

    for (const model of models) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [
            { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
            { text: 'Extrae con precisión los datos del DNI: CUI/DNI, nombres, primer apellido, segundo apellido, fecha nacimiento, fecha caducidad, nacionalidad, departamento, provincia, distrito y dirección completa.' },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: dniResponseSchema,
            temperature: 0.0,
          },
        });
        if (res && res.text) {
          aiResponseText = res.text;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!aiResponseText) {
      return NextResponse.json({ error: 'No se logró procesar los datos. Verifique la nitidez del archivo.' }, { status: 422 });
    }

    const extractedData = JSON.parse(aiResponseText);
    const detectedDni = (extractedData.cuiDni || '').replace(/\D/g, '');

    // 🎯 5. VALIDACIÓN DE CADUCIDAD
    const expirationCheck = checkDniExpiration(extractedData.fechaCaducidad);
    if (expirationCheck.isExpired) {
      return NextResponse.json(
        {
          success: false,
          error: `El Documento de Identidad (DNI) se encuentra VENCIDO desde el ${expirationCheck.dateFormatted}. Adjunte un DNI vigente.`,
          code: 'DNI_EXPIRED',
        },
        { status: 400 }
      );
    }

    // 6. Evaluar la verificación del DNI mediante CertificateValidator
    const validation = CertificateValidator.evaluateDniVerification({
      inputDni: certRequest.applicantDocNum,
      extractedDni: detectedDni,
      fileSizeBytes: dniDoc.fileSizeBytes,
      mimeType: dniDoc.mimeType,
    });

    // 7. Resolver Ubicación y Código Postal con la BD local
    const location = await LocationService.resolveLocationAndZip(
      extractedData.departamento || 'ICA',
      extractedData.provincia || 'ICA',
      extractedData.distrito || 'PARCONA'
    );

    // 8. Actualizar VerificationResult guardando la fecha de caducidad
    const verifModel = prisma.verificationResult || prisma.VerificationResult;
    if (verifModel) {
      await verifModel.upsert({
        where: { documentId: dniDoc.id },
        create: {
          documentId: dniDoc.id,
          isMatch: validation.isMatch,
          inputDocumentNum: certRequest.applicantDocNum,
          detectedDocumentNum: detectedDni,
          extractedNames: extractedData.nombres,
          extractedSurname1: extractedData.primerApellido,
          extractedSurname2: extractedData.segundoApellido,
          extractedBirthDate: extractedData.fechaNacimiento,
          extractedExpiryDate: extractedData.fechaCaducidad, // 👈 Guardado de caducidad
          extractedDepartment: location.department,
          extractedProvince: location.province,
          extractedDistrict: location.district,
          extractedAddress: extractedData.direccion,
          rawAiJsonResponse: extractedData,
        },
        update: {
          isMatch: validation.isMatch,
          detectedDocumentNum: detectedDni,
          extractedNames: extractedData.nombres,
          extractedSurname1: extractedData.primerApellido,
          extractedSurname2: extractedData.segundoApellido,
          extractedBirthDate: extractedData.fechaNacimiento,
          extractedExpiryDate: extractedData.fechaCaducidad, // 👈 Guardado de caducidad
          extractedDepartment: location.department,
          extractedProvince: location.province,
          extractedDistrict: location.district,
          extractedAddress: extractedData.direccion,
          rawAiJsonResponse: extractedData,
          verifiedAt: new Date(),
        },
      });
    }

    const updatedCert = await certModel.update({
      where: { id: requestId },
      data: {
        status: validation.status,
        applicantNames: extractedData.nombres || 'NO DETECTADO',
        applicantSurname1: extractedData.primerApellido || '',
        applicantSurname2: extractedData.segundoApellido || '',
        department: location.department,
        province: location.province,
        district: location.district,
        address: extractedData.direccion || null,
        postalCode: location.postalCode,
      },
    });

    return NextResponse.json({ success: true, message: 'Re-extracción completada con éxito.', data: updatedCert });

  } catch (error: any) {
    console.error('Error durante el re-procesamiento backend:', error);
    return NextResponse.json({ error: error?.message || 'Error interno del servidor.' }, { status: 500 });
  }
}