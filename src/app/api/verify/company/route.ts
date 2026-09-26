import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PrismaClient, EntityType, DocType, DocumentCategory, RequestStatus } from '@prisma/client';
import { uploadToSupabase } from '@/lib/supabase';
import { LocationService } from '@/lib/ubigeo-service';
const prisma = new PrismaClient();
const apiKey = process.env.GEMINI_API_KEY || '';

// Schemas Gemini
const dniSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    cuiDni: { type: Type.STRING },
    nombres: { type: Type.STRING },
    primerApellido: { type: Type.STRING },
    segundoApellido: { type: Type.STRING },
    departamento: { type: Type.STRING },
    provincia: { type: Type.STRING },
    distrito: { type: Type.STRING },
    direccion: { type: Type.STRING }
  },
  required: ['cuiDni', 'nombres', 'primerApellido'],
};

const fichaRucSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ruc: { type: Type.STRING },
    razonSocial: { type: Type.STRING },
    departamentoEmpresa: { type: Type.STRING },
    provinciaEmpresa: { type: Type.STRING },
    distritoEmpresa: { type: Type.STRING },
    direccionEmpresa: { type: Type.STRING },
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
    cargo: { type: Type.STRING },
    apoderadosDni: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['razonSocial'],
};

export async function POST(request: NextRequest) {
  try {
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY no configurada.' }, { status: 500 });
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
      return NextResponse.json({ error: 'Faltan documentos requeridos.' }, { status: 400 });
    }

    const [bufDni, bufRuc, bufVigencia] = await Promise.all([
      fileDni.arrayBuffer().then(b => Buffer.from(b)),
      fileRuc.arrayBuffer().then(b => Buffer.from(b)),
      fileVigencia.arrayBuffer().then(b => Buffer.from(b)),
    ]);

    const ai = new GoogleGenAI({ apiKey });

    const analyzeDoc = async (buffer: Buffer, schema: Schema, prompt: string) => {
      const base64Pdf = buffer.toString('base64');
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

          if (response && response.text) {
            return JSON.parse(response.text || '{}');
          }
        } catch (err: any) {
          console.warn(`[Gemini OCR Fallback] Error con ${model}:`, err?.message);
        }
      }
      return {};
    };

    // 1. Escaneo OCR
    const [dniData, rucData, vigenciaData] = await Promise.all([
      analyzeDoc(bufDni, dniSchema, 'Extrae el CUI/DNI, nombres, apellidos, departamento, provincia, distrito y dirección del DNI.'),
      analyzeDoc(bufRuc, fichaRucSchema, 'Extrae RUC, Razón Social, Domicilio Fiscal (Departamento, Provincia, Distrito, Dirección) y representantes de la Ficha RUC.'),
      analyzeDoc(bufVigencia, vigenciaPoderSchema, 'Extrae Razón Social, Cargo y apoderados de la Vigencia de Poder.'),
    ]);

    // 2. Evaluaciones de Coincidencia (Estrictas)
    const cleanInputDni = dniRepresentante.replace(/\D/g, '');
    const cleanExtDni = (dniData.cuiDni || '').replace(/\D/g, '');
    const cleanInputRuc = rucIngresado.replace(/\D/g, '');
    const cleanExtRuc = (rucData.ruc || '').replace(/\D/g, '');

    const rucDnis = (rucData.representantesLegalesDni || []).map((d: string) => d.replace(/\D/g, ''));
    const vigenciaDnis = (vigenciaData.apoderadosDni || []).map((d: string) => d.replace(/\D/g, ''));

    let dniReason: string | null = null;
    let rucReason: string | null = null;
    let vigenciaReason: string | null = null;

    // A. Validar DNI del documento vs DNI ingresado
    if (!cleanExtDni || cleanInputDni !== cleanExtDni) {
      dniReason = `El DNI extraído del documento (${cleanExtDni || 'NO DETECTADO'}) no coincide con el DNI ingresado (${cleanInputDni}).`;
    }

    // B. Validar RUC
    if (cleanExtRuc && cleanInputRuc !== cleanExtRuc) {
      rucReason = `El RUC extraído (${cleanExtRuc}) no coincide con el RUC ingresado (${cleanInputRuc}).`;
    }

    // C. Validar Apoderados
    if (rucDnis.length > 0 && !rucDnis.includes(cleanInputDni) && vigenciaDnis.length > 0 && !vigenciaDnis.includes(cleanInputDni)) {
      vigenciaReason = `El DNI ${cleanInputDni} no figura como representante legal en la Ficha RUC ni en la Vigencia de Poder.`;
    }

    const isDniMatch = !dniReason;
    const isRucMatch = !rucReason;
    const isVigenciaMatch = !vigenciaReason;

    const isGlobalValid = isDniMatch && isRucMatch && isVigenciaMatch;
    const finalStatus: RequestStatus = isGlobalValid ? RequestStatus.EN_REVISION : RequestStatus.RECHAZADO;

    // 3. Subida a Supabase
    const supabaseFolder = `verifications/company/${cleanInputRuc || Date.now()}`;
    const [dniSaved, rucSaved, vigenciaSaved] = await Promise.all([
      uploadToSupabase(fileDni, `${supabaseFolder}/dni`),
      uploadToSupabase(fileRuc, `${supabaseFolder}/ruc`),
      uploadToSupabase(fileVigencia, `${supabaseFolder}/vigencia`),
    ]);

    const defaultUser = await prisma.user.findFirst();
    if (!defaultUser) {
      return NextResponse.json({ error: 'No existe usuario base registrado.' }, { status: 500 });
    }
    const rawDept = rucData.departamentoEmpresa || dniData.departamento || 'ICA';
    const rawProv = rucData.provinciaEmpresa || dniData.provincia || 'ICA';
    const rawDist = rucData.distritoEmpresa || dniData.distrito || 'PARCONA';
    const certCode = `CERT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const location = await LocationService.resolveLocationAndZip(rawDept, rawProv, rawDist);
    // 4. Creación del Certificado asignando la Ubicación Extraída para Camerfirma
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
        applicantNames: isDniMatch ? (dniData.nombres || empresaIngresada) : (dniData.nombres || 'DNI NO COINCIDE'),
        applicantSurname1: isDniMatch ? (dniData.primerApellido || 'REPRESENTANTE') : (dniData.primerApellido || 'OBSERVADO'),
        applicantSurname2: dniData.segundoApellido || '',
        applicantEmail: email,
        applicantPhone: phone,
        
        // Guardar la dirección y ubigeo fiscal extraídos de la Ficha RUC / DNI
        department: rucData.departamentoEmpresa || dniData.departamento || null,
        province: rucData.provinciaEmpresa || dniData.provincia || null,
        district: rucData.distritoEmpresa || dniData.distrito || null,
        address: rucData.direccionEmpresa || dniData.direccion || null,
        postalCode: rucData.codigoPostal || location.postalCode, // Si Gemini no leyó CP, asigna el resuelto de la BD
        companyRuc: rucData.ruc || rucIngresado,
        companyName: rucData.razonSocial || empresaIngresada,
        rucType: (rucData.ruc || rucIngresado).startsWith('20') ? 'Persona Jurídica' : 'Persona Natural con Negocio',

        documents: {
          create: [
            {
              category: DocumentCategory.DNI_FRONT_BACK,
              fileName: fileDni.name,
              fileUrl: dniSaved.fileUrl,
              storagePath: dniSaved.storagePath,
              mimeType: fileDni.type || 'application/pdf',
              fileSizeBytes: bufDni.length,
              verificationResult: {
                create: {
                  isMatch: isDniMatch,
                  inputDocumentNum: dniRepresentante,
                  detectedDocumentNum: dniData.cuiDni || null,
                  extractedNames: dniData.nombres || null,
                  extractedSurname1: dniData.primerApellido || null,
                  extractedSurname2: dniData.segundoApellido || null,
                  extractedDepartment: dniData.departamento || null,
                  extractedProvince: dniData.provincia || null,
                  extractedDistrict: dniData.distrito || null,
                  extractedAddress: dniData.direccion || null,
                  rejectionReason: dniReason,
                  rawAiJsonResponse: dniData
                }
              }
            },
            {
              category: DocumentCategory.FICHA_RUC,
              fileName: fileRuc.name,
              fileUrl: rucSaved.fileUrl,
              storagePath: rucSaved.storagePath,
              mimeType: fileRuc.type || 'application/pdf',
              fileSizeBytes: bufRuc.length,
              verificationResult: {
                create: {
                  isMatch: isRucMatch,
                  inputDocumentNum: rucIngresado,
                  detectedDocumentNum: rucData.ruc || null,
                  extractedRuc: rucData.ruc || null,
                  extractedCompanyName: rucData.razonSocial || null,
                  extractedDepartment: rucData.departamentoEmpresa || null,
                  extractedProvince: rucData.provinciaEmpresa || null,
                  extractedDistrict: rucData.distritoEmpresa || null,
                  extractedAddress: rucData.direccionEmpresa || null,
                  rejectionReason: rucReason,
                  rawAiJsonResponse: rucData
                }
              }
            },
            {
              category: DocumentCategory.VIGENCIA_PODER,
              fileName: fileVigencia.name,
              fileUrl: vigenciaSaved.fileUrl,
              storagePath: vigenciaSaved.storagePath,
              mimeType: fileVigencia.type || 'application/pdf',
              fileSizeBytes: bufVigencia.length,
              verificationResult: {
                create: {
                  isMatch: isVigenciaMatch,
                  inputDocumentNum: dniRepresentante,
                  detectedDocumentNum: (vigenciaData.apoderadosDni || [])[0] || null,
                  extractedCompanyName: vigenciaData.razonSocial || null,
                  rejectionReason: vigenciaReason,
                  rawAiJsonResponse: vigenciaData
                }
              }
            },
          ]
        }
      },
      include: {
        documents: {
          include: { verificationResult: true }
        }
      }
    });

    return NextResponse.json({
      success: isGlobalValid,
      status: finalStatus,
      data: certRequest
    });

  } catch (error: any) {
    console.error('Error procesando empresa:', error);
    return NextResponse.json({ error: error?.message || 'Error en el servidor.' }, { status: 500 });
  }
}