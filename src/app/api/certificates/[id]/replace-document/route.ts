import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient, DocumentCategory, RequestStatus } from '@prisma/client';
import { CertificateValidator } from '@/validators/certificate.validator';
import { uploadToSupabase, deleteFromSupabase } from '@/lib/supabase';
import { LocationService } from '@/lib/ubigeo-service';

const prisma = new PrismaClient();
const apiKey = process.env.GEMINI_API_KEY || '';

const dniResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    documentoDetectado: { type: Type.BOOLEAN },
    cuiDni: { type: Type.STRING },
    nombres: { type: Type.STRING },
    primerApellido: { type: Type.STRING },
    segundoApellido: { type: Type.STRING },
    fechaNacimiento: { type: Type.STRING },
    fechaCaducidad: { type: Type.STRING, description: 'Fecha de caducidad en formato YYYY-MM-DD o DD/MM/YYYY' },
    nacionalidad: { type: Type.STRING },
    departamento: { type: Type.STRING },
    provincia: { type: Type.STRING },
    distrito: { type: Type.STRING },
    direccion: { type: Type.STRING },
  },
  required: ['documentoDetectado', 'cuiDni', 'nombres', 'primerApellido', 'segundoApellido'],
};

function checkDniExpiration(fechaCaducidadStr?: string): { isExpired: boolean; dateFormatted?: string } {
  if (!fechaCaducidadStr) return { isExpired: false };
  try {
    let expDate: Date;
    if (fechaCaducidadStr.includes('-')) {
      const parts = fechaCaducidadStr.split('-');
      expDate = parts[0].length === 4 
        ? new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
        : new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    } else if (fechaCaducidadStr.includes('/')) {
      const parts = fechaCaducidadStr.split('/');
      expDate = parts[2].length === 4
        ? new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
        : new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    } else {
      return { isExpired: false };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      isExpired: expDate < today,
      dateFormatted: expDate.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    };
  } catch {
    return { isExpired: false };
  }
}

async function processDniWithAi(ai: GoogleGenAI, base64Pdf: string) {
  const models = ['gemini-3.6-flash', 'gemini-3.5-flash'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
          { text: 'Extrae con precisión los datos del DNI en formato JSON: CUI/DNI, nombres, primer apellido, segundo apellido, fecha nacimiento, fecha caducidad, nacionalidad, departamento, provincia, distrito y dirección completa.' },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: dniResponseSchema,
          temperature: 0.0,
          maxOutputTokens: 2048,
        },
      });
      if (response && response.text) return response;
    } catch (e: any) {
      lastError = e;
      continue;
    }
  }
  throw new Error(`Fallo en el servicio OCR: ${lastError?.message || 'Error al leer PDF'}`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const requestId = resolvedParams?.id;

    if (!requestId || requestId === 'undefined') {
      return NextResponse.json({ error: 'ID de solicitud inválido.' }, { status: 400 });
    }

    const formData = await request.formData();
    const newFile = formData.get('file') as File;

    if (!newFile) {
      return NextResponse.json({ error: 'No se adjuntó ningún archivo.' }, { status: 400 });
    }

    const certRequest = await prisma.certificateRequest.findUnique({
      where: { id: requestId },
      include: { documents: true },
    });

    if (!certRequest) {
      return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 });
    }

    // 1. LEER EL PDF EN MEMORIA (SIN SUBIR A SUPABASE AÚN)
    const arrayBuffer = await newFile.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const base64Pdf = fileBuffer.toString('base64');

    const ai = new GoogleGenAI({ apiKey });
    const aiResponse = await processDniWithAi(ai, base64Pdf);

    let extractedData: any = {};
    try {
      extractedData = JSON.parse(aiResponse.text || '{}');
    } catch {
      return NextResponse.json(
        { error: 'El archivo adjunto no pudo ser procesado por la IA. Suba un documento PDF nítido.' },
        { status: 400 }
      );
    }

    const detectedDni = (extractedData.cuiDni || '').replace(/\D/g, '');

    // 2. BLOQUEO 1: VERIFICAR CADUCIDAD
    const expirationCheck = checkDniExpiration(extractedData.fechaCaducidad);
    if (expirationCheck.isExpired) {
      return NextResponse.json(
        {
          success: false,
          error: `El DNI subido se encuentra VENCIDO desde el ${expirationCheck.dateFormatted}. Adjunte un documento vigente.`,
          code: 'DNI_EXPIRED',
        },
        { status: 400 }
      );
    }

    // 3. BLOQUEO 2: VERIFICAR COINCIDENCIA CON EL DNI REGISTRADO EN EL EXPEDIENTE
    const cleanRegisteredDni = certRequest.applicantDocNum.replace(/\D/g, '');

    if (!detectedDni || detectedDni !== cleanRegisteredDni) {
      return NextResponse.json(
        {
          success: false,
          error: `Inconsistencia: El DNI detectado en el nuevo documento (${detectedDni || 'No detectado'}) no coincide con el DNI registrado en este expediente (${cleanRegisteredDni}).`,
          code: 'DNI_MISMATCH',
        },
        { status: 400 }
      );
    }

    // 🎯 4. ELIMINAR EL ARCHIVO ANTERIOR DE SUPABASE Y SUBIR EL NUEVO
    const targetDoc = certRequest.documents.find((d: any) => d.category === DocumentCategory.DNI_FRONT_BACK);

    if (targetDoc && targetDoc.storagePath) {
      await deleteFromSupabase(targetDoc.storagePath);
    }

    const timestamp = Date.now();
    const cleanName = newFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const newStoragePath = `verifications/dni/${certRequest.applicantDocNum}/${timestamp}_${cleanName}`;

    const savedFile = await uploadToSupabase(newFile, newStoragePath);
    const antiCacheUrl = `${savedFile.fileUrl}?v=${timestamp}`;

    const location = await LocationService.resolveLocationAndZip(
      extractedData.departamento || 'ICA',
      extractedData.provincia || 'ICA',
      extractedData.distrito || 'PARCONA'
    );

    // 5. Actualizar la tabla Document y VerificationResult en Prisma
    if (targetDoc) {
      const prismaClient = prisma as any;
      const docModel = prismaClient.document || prismaClient.certificateDocument;

      if (docModel) {
        await docModel.update({
          where: { id: targetDoc.id },
          data: {
            fileName: newFile.name,
            fileUrl: antiCacheUrl,
            storagePath: savedFile.storagePath,
            fileSizeBytes: fileBuffer.length,
            mimeType: newFile.type || 'application/pdf',
          },
        });
      }

      await prisma.verificationResult.upsert({
        where: { documentId: targetDoc.id },
        create: {
          documentId: targetDoc.id,
          isMatch: true,
          inputDocumentNum: certRequest.applicantDocNum,
          detectedDocumentNum: detectedDni,
          extractedNames: extractedData.nombres,
          extractedSurname1: extractedData.primerApellido,
          extractedSurname2: extractedData.segundoApellido,
          extractedBirthDate: extractedData.fechaNacimiento,
          extractedExpiryDate: extractedData.fechaCaducidad,
          extractedDepartment: location.department,
          extractedProvince: location.province,
          extractedDistrict: location.district,
          extractedAddress: extractedData.direccion,
          rawAiJsonResponse: extractedData,
        },
        update: {
          isMatch: true,
          detectedDocumentNum: detectedDni,
          extractedNames: extractedData.nombres,
          extractedSurname1: extractedData.primerApellido,
          extractedSurname2: extractedData.segundoApellido,
          extractedBirthDate: extractedData.fechaNacimiento,
          extractedExpiryDate: extractedData.fechaCaducidad,
          extractedDepartment: location.department,
          extractedProvince: location.province,
          extractedDistrict: location.district,
          extractedAddress: extractedData.direccion,
          rawAiJsonResponse: extractedData,
          verifiedAt: new Date(),
        },
      });
    }

    // 6. Actualizar la Solicitud Principal
    const updatedRequest = await prisma.certificateRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.EN_REVISION,
        progress: '1/1',
        applicantDocNum: detectedDni,
        applicantNames: extractedData.nombres || certRequest.applicantNames,
        applicantSurname1: extractedData.primerApellido || certRequest.applicantSurname1,
        applicantSurname2: extractedData.segundoApellido || certRequest.applicantSurname2,
        department: location.department,
        province: location.province,
        district: location.district,
        address: extractedData.direccion || certRequest.address,
        postalCode: location.postalCode,
      },
      include: {
        documents: { include: { verificationResult: true } },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Documento reemplazado y verificado correctamente.',
      data: updatedRequest,
    });

  } catch (error: any) {
    console.error('Error al reemplazar el documento:', error);
    return NextResponse.json({ error: error?.message || 'Error interno al procesar el archivo.' }, { status: 500 });
  }
}