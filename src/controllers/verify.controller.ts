// backend-hyperion/src/controllers/verify.controller.ts

import { Request, Response } from 'express';
import { PrismaClient, EntityType, DocumentCategory } from '@prisma/client';
// 1. IMPORTAR LA FUNCIÓN DEL BOT DE AUTOMATIZACIÓN
import { submitCamerfirmaForm } from '../service/camerfirmaAutomation';

const prisma = new PrismaClient();

export const handleVerifyDni = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const {
      documentNumber,
      email,
      phone,
      entityType,
      planType,
      companyRuc,
      companyName,
      rucType,
    } = req.body;

    const rawEntityType = String(entityType || '').trim().toUpperCase();
    const isEmpresa = rawEntityType === 'EMPRESA' || rawEntityType === 'COMPANY';

    // 1. CREAR LA SOLICITUD DE CERTIFICADO PRINCIPAL
    const newRequest = await prisma.certificateRequest.create({
      data: {
        code: `CERT-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        userId: req.user.id,
        entityType: isEmpresa ? EntityType.EMPRESA : EntityType.PERSONA_NATURAL,
        progress: isEmpresa ? '1/3' : '1/1',
        status: 'EN_REVISION',
        planType: planType || 'ONE_SHOT',

        applicantDocNum: documentNumber || '',
        applicantEmail: email || '',
        applicantPhone: phone || '',
        applicantNames: req.body.applicantNames || 'Titular',
        applicantSurname1: req.body.applicantSurname1 || '',
        applicantSurname2: req.body.applicantSurname2 || '',

        companyRuc: isEmpresa ? String(companyRuc || '').trim() : null,
        companyName: isEmpresa ? String(companyName || '').trim() : null,
        rucType: isEmpresa ? String(rucType || '').trim() : null,
      },
    });

    // 2. REGISTRAR LOS DATOS EN VERIFICATION_REQUESTS (PARA /api/user/export)
    const rawNames = req.body.applicantNames || 'TITULAR';
    const rawSurname1 = req.body.applicantSurname1 || '';
    const rawSurname2 = req.body.applicantSurname2 || '';
    
    const firstNames = String(rawNames).trim().toUpperCase();
    const lastNames = `${rawSurname1} ${rawSurname2}`.trim().toUpperCase();
    const fullName = `${firstNames} ${lastNames}`.trim().toUpperCase();

    if (documentNumber) {
      await prisma.verificationRequest.create({
        data: {
          userId: req.user.id,
          entityType: isEmpresa ? EntityType.EMPRESA : EntityType.PERSONA_NATURAL,
          documentNumber: String(documentNumber).trim(),
          extractedFirstName: firstNames,
          extractedLastName: lastNames,
          extractedFullName: fullName,
          email: email || null,
          phone: phone || null,
          companyRuc: isEmpresa ? String(companyRuc || '').trim() : null,
          companyName: isEmpresa ? String(companyName || '').trim() : null,
          isVerified: true,
        },
      });
    }

    // 3. CONSTRUIR Y ADJUNTAR LOS DOCUMENTOS EN REQUEST_DOCUMENTS
    const docsToInsert = [];

    if (files?.file?.[0]) {
      docsToInsert.push({
        requestId: newRequest.id,
        category: DocumentCategory.DNI_FRONT_BACK,
        fileName: files.file[0].originalname,
        fileUrl: `/uploads/${files.file[0].filename}`,
        mimeType: files.file[0].mimetype,
      });
    }

    if (isEmpresa && files?.fileRuc?.[0]) {
      docsToInsert.push({
        requestId: newRequest.id,
        category: DocumentCategory.FICHA_RUC,
        fileName: files.fileRuc[0].originalname,
        fileUrl: `/uploads/${files.fileRuc[0].filename}`,
        mimeType: files.fileRuc[0].mimetype,
      });
    }

    if (isEmpresa && files?.fileVigencia?.[0]) {
      docsToInsert.push({
        requestId: newRequest.id,
        category: DocumentCategory.VIGENCIA_PODER,
        fileName: files.fileVigencia[0].originalname,
        fileUrl: `/uploads/${files.fileVigencia[0].filename}`,
        mimeType: files.fileVigencia[0].mimetype,
      });
    }

    if (docsToInsert.length > 0) {
      await prisma.requestDocument.createMany({
        data: docsToInsert,
      });
    }

    const fullRequest = await prisma.certificateRequest.findUnique({
      where: { id: newRequest.id },
      include: { documents: true },
    });

    // 📌 4. DISPARAR AUTOMATIZACIÓN DE CAMERFIRMA EN SEGUNDO PLANO (SIN AWAIT)
    submitCamerfirmaForm({
      entityType: isEmpresa ? 'EMPRESA' : 'PERSONA_NATURAL',
      documentNumber: String(documentNumber).trim(),
      firstNames: firstNames,
      lastName1: rawSurname1,
      lastName2: rawSurname2,
      email: email,
      phone: phone,
      companyRuc: companyRuc,
      companyName: companyName,
      fileDniPath: files?.file?.[0]?.path,
      fileRucPath: files?.fileRuc?.[0]?.path,
      fileVigenciaPath: files?.fileVigencia?.[0]?.path,
    }).catch((err) => console.error('Error enviando a Camerfirma en background:', err));

    // 5. RETORNAR RESPUESTA AL CLIENTE
    return res.status(201).json({ success: true, data: fullRequest });

  } catch (error: any) {
    console.error('Error procesando /api/verify/dni:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
};