import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient, EntityType, DocType, DocumentCategory } from '@prisma/client';
import { CertificateValidator } from '@/validators/certificate.validator';

const prisma = new PrismaClient();
const apiKey = process.env.GEMINI_API_KEY || '';

// Schema DNI ampliado con ubicación y dirección completa
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
    departamento: { type: Type.STRING, description: 'Departamento según el DNI' },
    provincia: { type: Type.STRING, description: 'Provincia según el DNI' },
    distrito: { type: Type.STRING, description: 'Distrito según el DNI' },
    direccion: { type: Type.STRING, description: 'Dirección o domicilio completo impreso' },
  },
  required: ['documentoDetectado', 'cuiDni', 'nombres', 'primerApellido', 'segundoApellido'],
};

async function saveFileToDisk(file: File): Promise<{ fileUrl: string; buffer: Buffer }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });

  const filename = `${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
  const filePath = path.join(uploadDir, filename);
  await writeFile(filePath, buffer);

  return { fileUrl: `/uploads/${filename}`, buffer };
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
          { text: 'Extrae con precisión los datos del DNI: CUI/DNI (8 dígitos), nombres, primer apellido, segundo apellido, fecha de nacimiento, nacionalidad, departamento, provincia, distrito y dirección completa.' },
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
    const fileRuc = formData.get('fileRuc') as File | null;
    const fileVigencia = formData.get('fileVigencia') as File | null;

    const inputDni = ((formData.get('documentNumber') as string) || '').trim();
    const applicantEmail = ((formData.get('email') as string) || '').trim();
    const applicantPhone = ((formData.get('phone') as string) || '').trim();
    const rawEntityType = ((formData.get('entityType') as string) || 'PERSONA_NATURAL').trim();
    const planType = ((formData.get('planType') as string) || 'ONE_SHOT').trim();
    const companyRuc = ((formData.get('companyRuc') as string) || '').trim();
    const companyName = ((formData.get('companyName') as string) || '').trim();

    const isEmpresa = rawEntityType === 'EMPRESA' || rawEntityType === 'company';

    if (!fileDni || !inputDni || !applicantEmail || !applicantPhone) {
      return NextResponse.json({ error: 'Faltan datos obligatorios del representante o titular.' }, { status: 400 });
    }

    if (isEmpresa && (!fileRuc || !fileVigencia || !companyRuc || !companyName)) {
      return NextResponse.json({ error: 'Para registro de Empresa, Ficha RUC, Vigencia, RUC y Razón Social son requeridos.' }, { status: 400 });
    }

    // 1. Guardar DNI y Procesar OCR
    const dniSaved = await saveFileToDisk(fileDni);
    const ai = new GoogleGenAI({ apiKey });
    const aiResponse = await processDniWithAi(ai, dniSaved.buffer.toString('base64'));

    const extractedData = JSON.parse(aiResponse.text || '{}');
    const detectedDni = (extractedData.cuiDni || '').replace(/\D/g, '');

    // 2. Evaluar DNI
    const validation = CertificateValidator.evaluateDniVerification({
      inputDni,
      extractedDni: detectedDni,
      fileSizeBytes: dniSaved.buffer.length,
      mimeType: fileDni.type || 'application/pdf',
    });

    const defaultUser = await prisma.user.findFirst();
    if (!defaultUser) {
      return NextResponse.json({ error: 'No existe usuario base registrado.' }, { status: 500 });
    }

    // 3. Mapear Documentos
    const documentsToCreate: any[] = [
      {
        category: DocumentCategory.DNI_FRONT_BACK,
        fileName: fileDni.name,
        fileUrl: dniSaved.fileUrl,
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
            rawAiJsonResponse: extractedData,
          },
        },
      },
    ];

    if (isEmpresa && fileRuc && fileVigencia) {
      const rucSaved = await saveFileToDisk(fileRuc);
      const vigenciaSaved = await saveFileToDisk(fileVigencia);

      documentsToCreate.push({
        category: DocumentCategory.FICHA_RUC,
        fileName: fileRuc.name,
        fileUrl: rucSaved.fileUrl,
        mimeType: fileRuc.type || 'application/pdf',
        fileSizeBytes: rucSaved.buffer.length,
      });

      documentsToCreate.push({
        category: DocumentCategory.VIGENCIA_PODER,
        fileName: fileVigencia.name,
        fileUrl: vigenciaSaved.fileUrl,
        mimeType: fileVigencia.type || 'application/pdf',
        fileSizeBytes: vigenciaSaved.buffer.length,
      });
    }

    // 4. Crear Certificado guardando la ubicación extraída
    const certCode = `CERT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const certRequest = await prisma.certificateRequest.create({
      data: {
        code: certCode,
        userId: defaultUser.id,
        entityType: isEmpresa ? EntityType.EMPRESA : EntityType.PERSONA_NATURAL,
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
        
        // 📍 Asignación explícita de campos de ubicación
        department: extractedData.departamento || null,
        province: extractedData.provincia || null,
        district: extractedData.distrito || null,
        address: extractedData.direccion || null,

        companyRuc: isEmpresa ? companyRuc : null,
        companyName: isEmpresa ? companyName : null,
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