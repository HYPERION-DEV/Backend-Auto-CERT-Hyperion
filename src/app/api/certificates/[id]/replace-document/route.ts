import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient, DocumentCategory } from '@prisma/client';
import { CertificateValidator } from '@/validators/certificate.validator';
import { uploadToSupabase } from '@/lib/supabase';
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
    nacionalidad: { type: Type.STRING },
    departamento: { type: Type.STRING },
    provincia: { type: Type.STRING },
    distrito: { type: Type.STRING },
    direccion: { type: Type.STRING },
  },
  required: ['documentoDetectado', 'cuiDni', 'nombres', 'primerApellido', 'segundoApellido'],
};

async function processDniWithAi(ai: GoogleGenAI, base64Pdf: string) {
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro'];
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
          { text: 'Extrae con precisión los datos del DNI: CUI/DNI, nombres, primer apellido, segundo apellido, fecha nacimiento, nacionalidad, departamento, provincia, distrito y dirección completa.' },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: dniResponseSchema,
          temperature: 0.0,
        },
      });
      if (response && response.text) return response;
    } catch (e) {
      continue;
    }
  }
  throw new Error('Error al procesar el OCR con la IA.');
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: requestId } = params;
    const formData = await request.formData();
    const newFile = formData.get('file') as File;

    if (!newFile) {
      return NextResponse.json({ error: 'No se adjuntó ningún archivo nuevo.' }, { status: 400 });
    }

    // 1. Obtener la solicitud actual
    const certRequest = await prisma.certificateRequest.findUnique({
      where: { id: requestId },
      include: { documents: true },
    });

    if (!certRequest) {
      return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 });
    }

    // 2. Subir nuevo archivo a Supabase
    const savedFile = await uploadToSupabase(newFile, `verifications/dni/${certRequest.applicantDocNum}/replaced_${Date.now()}`);

    // 3. Re-ejecutar OCR con Gemini
    const ai = new GoogleGenAI({ apiKey });
    const aiResponse = await processDniWithAi(ai, savedFile.buffer.toString('base64'));
    const extractedData = JSON.parse(aiResponse.text || '{}');
    const detectedDni = (extractedData.cuiDni || '').replace(/\D/g, '');

    // 4. Evaluar coincidencia del número de DNI
    const validation = CertificateValidator.evaluateDniVerification({
      inputDni: certRequest.applicantDocNum,
      extractedDni: detectedDni,
      fileSizeBytes: savedFile.buffer.length,
      mimeType: newFile.type || 'application/pdf',
    });

    // 5. Resolver Ubicación y Código Postal corregidos
    const location = await LocationService.resolveLocationAndZip(
      extractedData.departamento || 'ICA',
      extractedData.provincia || 'ICA',
      extractedData.distrito || 'PARCONA'
    );

    // 6. Actualizar el documento en la base de datos
    const targetDoc = certRequest.documents.find(d => d.category === DocumentCategory.DNI_FRONT_BACK);

    if (targetDoc) {
      // Usamos el cliente de Prisma adaptado para evitar conflictos de tipo si la relación se llama diferente
      const prismaClient = prisma as any;

      // Actualizar la tabla de documentos (evaluando alias 'document' o 'certificateDocument')
      const docModel = prismaClient.document || prismaClient.certificateDocument;

      if (docModel) {
        await docModel.update({
          where: { id: targetDoc.id },
          data: {
            fileName: newFile.name,
            fileUrl: savedFile.fileUrl,
            storagePath: savedFile.storagePath,
            fileSizeBytes: savedFile.buffer.length,
            mimeType: newFile.type || 'application/pdf',
          },
        });
      }

      // Actualizar o Crear el resultado de verificación
      await prisma.verificationResult.upsert({
        where: { documentId: targetDoc.id },
        create: {
          documentId: targetDoc.id,
          isMatch: validation.isMatch,
          inputDocumentNum: certRequest.applicantDocNum,
          detectedDocumentNum: detectedDni,
          extractedNames: extractedData.nombres,
          extractedSurname1: extractedData.primerApellido,
          extractedSurname2: extractedData.segundoApellido,
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
          extractedDepartment: location.department,
          extractedProvince: location.province,
          extractedDistrict: location.district,
          extractedAddress: extractedData.direccion,
          rawAiJsonResponse: extractedData,
          verifiedAt: new Date(),
        },
      });
    }

    // 7. Actualizar la Solicitud Principal con los nuevos datos del Titular
    const updatedRequest = await prisma.certificateRequest.update({
      where: { id: requestId },
      data: {
        status: validation.status,
        progress: validation.progress,
        applicantNames: validation.isMatch ? extractedData.nombres : 'DOCUMENTO NO COINCIDE',
        applicantSurname1: validation.isMatch ? extractedData.primerApellido : 'PENDIENTE DE REEMPLAZO',
        applicantSurname2: validation.isMatch ? (extractedData.segundoApellido || '') : '',
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
      message: 'Documento reemplazado y extraído correctamente.',
      data: updatedRequest,
    });

  } catch (error: any) {
    console.error('Error al reemplazar el documento:', error);
    return NextResponse.json({ error: error?.message || 'Error interno al procesar el archivo.' }, { status: 500 });
  }
}