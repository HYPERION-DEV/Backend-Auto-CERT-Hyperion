// backend-hyperion/src/app/api/verify/company/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient, EntityType, DocType, DocumentCategory, RequestStatus } from '@prisma/client';

const prisma = new PrismaClient();
const apiKey = process.env.GEMINI_API_KEY || '';

// Schemas
const dniSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    cuiDni: { type: Type.STRING },
    nombres: { type: Type.STRING },
    primerApellido: { type: Type.STRING },
    segundoApellido: { type: Type.STRING },
    fechaCaducidad: { type: Type.STRING },
  },
  required: ['cuiDni', 'nombres', 'primerApellido'],
};

const fichaRucSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ruc: { type: Type.STRING },
    razonSocial: { type: Type.STRING },
    estadoContribuyente: { type: Type.STRING },
    condicionContribuyente: { type: Type.STRING },
    representantesLegalesDni: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['ruc', 'razonSocial'],
};

const vigenciaPoderSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    razonSocial: { type: Type.STRING },
    apoderadosDni: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    fechaEmision: { type: Type.STRING },
  },
  required: ['razonSocial'],
};

const clean = (str: string) =>
  (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .trim();

// Guardado de buffer a disco local sin re-consumir streams
async function saveBufferToDisk(buffer: Buffer, originalName: string): Promise<string> {
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });

  const fileName = `${Date.now()}-${originalName.replace(/\s+/g, '_')}`;
  const filePath = path.join(uploadDir, fileName);
  await writeFile(filePath, buffer);

  return `/uploads/${fileName}`;
}

export async function POST(request: NextRequest) {
  try {
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY no configurada en el servidor.' }, { status: 500 });
    }

    const formData = await request.formData();
    const fileDni = formData.get('fileDni') as File;
    const fileRuc = formData.get('fileRuc') as File;
    const fileVigencia = formData.get('fileVigencia') as File;

    const rucIngresado = ((formData.get('companyRuc') as string) || '').trim();
    const empresaIngresada = ((formData.get('companyName') as string) || '').trim();
    const dniRepresentante = ((formData.get('documentNumber') as string) || '').trim();
    const email = ((formData.get('email') as string) || '').trim();
    const phone = ((formData.get('phone') as string) || '').trim();
    const planType = ((formData.get('planType') as string) || 'ANNUAL').trim();

    if (!fileDni || !fileRuc || !fileVigencia) {
      return NextResponse.json(
        { error: 'Se requieren obligatoriamente los 3 documentos (DNI, Ficha RUC, Vigencia de Poder).' },
        { status: 400 }
      );
    }

    // Convertir a Buffers una única vez
    const [bufDni, bufRuc, bufVigencia] = await Promise.all([
      fileDni.arrayBuffer().then(b => Buffer.from(b)),
      fileRuc.arrayBuffer().then(b => Buffer.from(b)),
      fileVigencia.arrayBuffer().then(b => Buffer.from(b)),
    ]);

    const ai = new GoogleGenAI({ apiKey });

    const analyzeDoc = async (buffer: Buffer, schema: Schema, prompt: string) => {
      const base64Pdf = buffer.toString('base64');
      // Nombres de modelos totalmente soportados
      const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];

      for (const model of models) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [
              { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
              { text: prompt },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              temperature: 0.0,
            },
          });

          return JSON.parse(response.text || '{}');
        } catch (err: any) {
          console.warn(`[Gemini OCR Fallback] Falló con modelo ${model}:`, err?.message);
        }
      }
      return {};
    };

    // 1. Escaneo OCR en Paralelo
    const [dniData, rucData, vigenciaData] = await Promise.all([
      analyzeDoc(bufDni, dniSchema, 'Extrae el DNI de 8 dígitos y la fecha de caducidad.'),
      analyzeDoc(bufRuc, fichaRucSchema, 'Extrae RUC, Razón Social, Estado, Condición y lista de DNI de representantes legales.'),
      analyzeDoc(bufVigencia, vigenciaPoderSchema, 'Extrae la Razón Social, la fecha de emisión y lista de DNI de apoderados.'),
    ]);

    // 2. Matriz de Validación Cruzada
    const cleanDniForm = dniRepresentante.replace(/\D/g, '');
    const cleanDniDetected = (dniData.cuiDni || '').replace(/\D/g, '');
    const cleanRucForm = rucIngresado.replace(/\D/g, '');
    const cleanRucDetected = (rucData.ruc || '').replace(/\D/g, '');

    const rucDnis = (rucData.representantesLegalesDni || []).map((d: string) => d.replace(/\D/g, ''));
    const vigenciaDnis = (vigenciaData.apoderadosDni || []).map((d: string) => d.replace(/\D/g, ''));

    const rejectionReasons: string[] = [];

    if (cleanDniDetected && cleanDniForm !== cleanDniDetected) {
      rejectionReasons.push(`DNI ingresado (${cleanDniForm}) no coincide con el escaneado (${cleanDniDetected}).`);
    }

    if (cleanRucDetected && cleanRucForm !== cleanRucDetected) {
      rejectionReasons.push(`RUC ingresado (${cleanRucForm}) no coincide con la Ficha RUC (${cleanRucDetected}).`);
    }

    // Validación estricta de apoderados (solo si se leyeron representantes/apoderados)
    if (rucDnis.length > 0 && !rucDnis.includes(cleanDniForm)) {
      rejectionReasons.push('El DNI no figura entre los representantes legales de la Ficha RUC.');
    }
    if (vigenciaDnis.length > 0 && !vigenciaDnis.includes(cleanDniForm)) {
      rejectionReasons.push('El DNI no figura como apoderado en la Vigencia de Poder.');
    }

    // Validación Razón Social
    const cleanRazonRuc = clean(rucData.razonSocial || empresaIngresada);
    const cleanRazonVigencia = clean(vigenciaData.razonSocial || empresaIngresada);

    if (cleanRazonRuc && cleanRazonVigencia && !cleanRazonRuc.includes(cleanRazonVigencia) && !cleanRazonVigencia.includes(cleanRazonRuc)) {
      rejectionReasons.push('La Razón Social en la Ficha RUC no coincide con la Vigencia de Poder.');
    }

    const isValid = rejectionReasons.length === 0;
    const finalStatus: RequestStatus = isValid ? RequestStatus.EN_REVISION : RequestStatus.RECHAZADO;

    // 3. Persistencia de archivos en disco
    const [urlDni, urlRuc, urlVigencia] = await Promise.all([
      saveBufferToDisk(bufDni, fileDni.name),
      saveBufferToDisk(bufRuc, fileRuc.name),
      saveBufferToDisk(bufVigencia, fileVigencia.name),
    ]);

    const defaultUser = await prisma.user.findFirst();
    if (!defaultUser) {
      return NextResponse.json({ error: 'No existe usuario base registrado en la base de datos.' }, { status: 500 });
    }

    const certCode = `CERT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 4. Inserción Transaccional en Postgres
    const certRequest = await prisma.certificateRequest.create({
      data: {
        code: certCode,
        userId: defaultUser.id,
        entityType: EntityType.EMPRESA,
        planType,
        status: finalStatus,
        progress: '3/3',
        applicantDocType: DocType.DNI,
        applicantDocNum: dniRepresentante,
        applicantNames: dniData.nombres || empresaIngresada,
        applicantSurname1: dniData.primerApellido || 'REPRESENTANTE',
        applicantSurname2: dniData.segundoApellido || '',
        applicantEmail: email,
        applicantPhone: phone,
        companyRuc: rucData.ruc || rucIngresado,
        companyName: rucData.razonSocial || empresaIngresada,
        rucType: (rucData.ruc || rucIngresado).startsWith('20') ? 'Persona Jurídica' : 'Persona Natural con Negocio',
        documents: {
          create: [
            {
              category: DocumentCategory.DNI_FRONT_BACK,
              fileName: fileDni.name,
              fileUrl: urlDni,
              mimeType: fileDni.type || 'application/pdf',
              fileSizeBytes: bufDni.length,
            },
            {
              category: DocumentCategory.FICHA_RUC,
              fileName: fileRuc.name,
              fileUrl: urlRuc,
              mimeType: fileRuc.type || 'application/pdf',
              fileSizeBytes: bufRuc.length,
            },
            {
              category: DocumentCategory.VIGENCIA_PODER,
              fileName: fileVigencia.name,
              fileUrl: urlVigencia,
              mimeType: fileVigencia.type || 'application/pdf',
              fileSizeBytes: bufVigencia.length,
            },
          ],
        },
      },
      include: {
        documents: true,
      },
    });

    return NextResponse.json({
      success: isValid,
      status: finalStatus,
      rejectionReasons,
      data: certRequest,
    });

  } catch (error: any) {
    console.error('Error procesando empresa:', error);
    return NextResponse.json({ error: error?.message || 'Error en el servidor durante la validación.' }, { status: 500 });
  }
}