import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import { CertificateValidator } from '@/validators/certificate.validator';

const prisma = new PrismaClient();
const apiKey = process.env.GEMINI_API_KEY || '';

const dniResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    documentoDetectado: { type: Type.BOOLEAN },
    cuiDni: { type: Type.STRING, description: 'Número de DNI de 8 dígitos' },
    nombres: { type: Type.STRING },
    primerApellido: { type: Type.STRING },
    segundoApellido: { type: Type.STRING },
    fechaNacimiento: { type: Type.STRING },
    nacionalidad: { type: Type.STRING },
  },
  required: ['documentoDetectado', 'cuiDni', 'nombres', 'primerApellido', 'segundoApellido'],
};

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // 1. Obtener solicitud actual
    const certRequest = await prisma.certificateRequest.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: { documents: true },
    });

    if (!certRequest) {
      return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Debe adjuntar el archivo PDF de reemplazo.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 2. Guardar el nuevo PDF localmente
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const filename = `${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);
    const fileUrl = `/uploads/${filename}`;

    // 3. Re-procesar OCR con Gemini
    const ai = new GoogleGenAI({ apiKey });
    const base64Pdf = buffer.toString('base64');

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
        { text: 'Extrae con precisión los datos visibles en el DNI: número de 8 dígitos, nombres, primer apellido, segundo apellido, fecha de nacimiento y nacionalidad.' },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: dniResponseSchema,
        temperature: 0.0,
      },
    });

    const extractedData = JSON.parse(response.text || '{}');
    const detectedDni = (extractedData.cuiDni || '').replace(/\D/g, '');

    // 4. Evaluar con el Validador Aislado
    const validation = CertificateValidator.evaluateDniVerification({
      inputDni: certRequest.applicantDocNum,
      extractedDni: detectedDni,
      fileSizeBytes: buffer.length,
      mimeType: file.type || 'application/pdf',
    });

    // 5. Actualizar registro del documento y OCR en base de datos
    const existingDoc = certRequest.documents[0];

    if (existingDoc) {
      await prisma.requestDocument.update({
        where: { id: existingDoc.id },
        data: {
          fileName: file.name,
          fileUrl,
          fileSizeBytes: buffer.length,
          verificationResult: {
            upsert: {
              create: {
                isMatch: validation.isMatch,
                inputDocumentNum: certRequest.applicantDocNum,
                detectedDocumentNum: detectedDni,
                extractedNames: extractedData.nombres,
                extractedSurname1: extractedData.primerApellido,
                extractedSurname2: extractedData.segundoApellido,
                extractedBirthDate: extractedData.fechaNacimiento,
                extractedNationality: extractedData.nacionalidad,
                rawAiJsonResponse: extractedData,
              },
              update: {
                isMatch: validation.isMatch,
                detectedDocumentNum: detectedDni,
                extractedNames: extractedData.nombres,
                extractedSurname1: extractedData.primerApellido,
                extractedSurname2: extractedData.segundoApellido,
                extractedBirthDate: extractedData.fechaNacimiento,
                extractedNationality: extractedData.nacionalidad,
                rawAiJsonResponse: extractedData,
              },
            },
          },
        },
      });
    }

    // 6. ACTUALIZAR ESTADO Y NOMBRES DEL TITULAR SI EL REEMPLAZO FUE EXITOSO
    const updatedCert = await prisma.certificateRequest.update({
      where: { id: certRequest.id },
      data: {
        status: validation.status,
        progress: validation.progress,
        // Solo sobrescribir los nombres del titular con el OCR si el nuevo documento SÍ COINCIDE
        ...(validation.isMatch && {
          applicantNames: extractedData.nombres || 'NO DETECTADO',
          applicantSurname1: extractedData.primerApellido || '',
          applicantSurname2: extractedData.segundoApellido || '',
        }),
      },
      include: {
        documents: { include: { verificationResult: true } },
      },
    });

    return NextResponse.json({
      success: true,
      validation,
      data: updatedCert,
    });

  } catch (error: any) {
    console.error('Error al reemplazar el documento:', error);
    return NextResponse.json(
      { error: error?.message || 'Error en el servidor al revalidar el documento.' },
      { status: 500 }
    );
  }
}