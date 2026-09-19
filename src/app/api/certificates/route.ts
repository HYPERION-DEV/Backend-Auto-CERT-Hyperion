// backend-hyperion/src/app/api/certificates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient, EntityType, DocType, DocumentCategory } from '@prisma/client';
import { registerClientInBiocamer } from '../../../service/biocamer.service';
import { getAuthUser } from '@/lib/auth';

const prisma = new PrismaClient();
const apiKey = process.env.GEMINI_API_KEY || '';
const origin = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';

const makeCorsResponse = (data: any, status = 200) => {
  const res = NextResponse.json(data, { status });
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
};

// 1. Schema DNI exacto con ubicación
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

// 2. Helper de guardado en disco
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

// 3. Procesamiento directo con Gemini AI (Lógica idéntica a tu /api/verify/dni)
async function processDniWithAi(ai: GoogleGenAI, base64Pdf: string) {
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
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

// =======================================================
// OBTENER LISTADO DE CERTIFICADOS (GET)
// =======================================================
export async function GET(request: NextRequest) {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return makeCorsResponse(
        { error: 'Sesión expirada o inválida. Por favor, vuelva a iniciar sesión.' },
        401
      );
    }

    const whereClause = user.role === 'ADMIN' || user.role === 'OPERATOR' 
      ? {} 
      : { userId: user.userId };

    const requests = await prisma.certificateRequest.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        documents: {
          include: { verificationResult: true },
        },
      },
    });

    return makeCorsResponse({
      success: true,
      data: requests,
    });

  } catch (error: any) {
    console.error('Error al listar certificados:', error);
    return makeCorsResponse(
      { error: error?.message || 'Error interno al consultar la base de datos.' },
      500
    );
  }
}

// =======================================================
// REGISTRAR, PROCESAR CON IA Y DISPARAR BIOCAMER (POST)
// =======================================================
export async function POST(request: NextRequest) {
  try {
    if (!apiKey) {
      return makeCorsResponse({ error: 'GEMINI_API_KEY no configurada en .env.' }, 500);
    }

    const user = getAuthUser(request);
    if (!user) {
      return makeCorsResponse(
        { error: 'Sesión expirada o inválida. Por favor, vuelva a iniciar sesión.' },
        401
      );
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
      return makeCorsResponse({ error: 'Faltan datos obligatorios del representante o titular.' }, 400);
    }

    // A. Guardar DNI y Procesar OCR directamente con Gemini AI
    const dniSaved = await saveFileToDisk(fileDni);
    const ai = new GoogleGenAI({ apiKey });
    
    let extractedData: any = {};
    let detectedDni = '';
    let isMatch = false;

    try {
      const aiResponse = await processDniWithAi(ai, dniSaved.buffer.toString('base64'));
      extractedData = JSON.parse(aiResponse.text || '{}');
      detectedDni = (extractedData.cuiDni || '').replace(/\D/g, '');
      isMatch = detectedDni !== '' && detectedDni === inputDni;
    } catch (aiError) {
      console.error('[OCR Error]:', aiError);
    }

    // B. Mapear Documentos Requeridos
    const documentsToCreate: any[] = [
      {
        category: DocumentCategory.DNI_FRONT_BACK,
        fileName: fileDni.name,
        fileUrl: dniSaved.fileUrl,
        mimeType: fileDni.type || 'application/pdf',
        fileSizeBytes: dniSaved.buffer.length,
        verificationResult: {
          create: {
            isMatch,
            inputDocumentNum: inputDni,
            detectedDocumentNum: detectedDni || inputDni,
            extractedNames: extractedData.nombres || '',
            extractedSurname1: extractedData.primerApellido || '',
            extractedSurname2: extractedData.segundoApellido || '',
            extractedBirthDate: extractedData.fechaNacimiento || '',
            extractedNationality: extractedData.nacionalidad || '',
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

    const certCode = `CERT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // C. Crear Certificado guardando la ubicación extraída por Gemini
    const certRequest = await prisma.certificateRequest.create({
      data: {
        code: certCode,
        userId: user.userId,
        entityType: isEmpresa ? EntityType.EMPRESA : EntityType.PERSONA_NATURAL,
        planType,
        status: 'EN_REVISION',
        progress: '1/1',
        applicantDocType: DocType.DNI,
        applicantDocNum: inputDni,
        
        // Mapeo exacto de los campos extraídos por tu schema
        applicantNames: extractedData.nombres || 'NO DETECTADO',
        applicantSurname1: extractedData.primerApellido || 'PENDIENTE',
        applicantSurname2: extractedData.segundoApellido || '',
        
        applicantEmail,
        applicantPhone,
        
        department: extractedData.departamento || null,
        province: extractedData.provincia || null,
        district: extractedData.distrito || null,
        address: extractedData.direccion || null,

        companyRuc: isEmpresa ? companyRuc : null,
        companyName: isEmpresa ? companyName : null,
        
        identityStatus: 'PENDING',
        identityVerified: false,

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

    // D. Disparar registro en BioCamer en segundo plano
    registerClientInBiocamer({
      docType: 'DNI',
      docNumber: inputDni,
    })
      .then(async () => {
        await prisma.certificateRequest.update({
          where: { id: certRequest.id },
          data: { identityStatus: 'REGISTERED' },
        });
        console.log(`[BioCamer Sync] DNI ${inputDni} registrado correctamente en BioCamer.`);
      })
      .catch((err) => console.error('[BioCamer Sync Error]:', err));

    return makeCorsResponse(
      {
        success: true,
        message: 'Solicitud creada con éxito, procesada con IA y alta iniciada en BioCamer.',
        data: certRequest,
      },
      201
    );

  } catch (error: any) {
    console.error('Error en POST /api/certificates:', error);
    return makeCorsResponse({ error: error?.message || 'Error interno del servidor.' }, 500);
  }
}