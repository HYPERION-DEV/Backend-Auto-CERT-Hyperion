// backend-hyperion/src/controllers/certificate.controller.ts

import { Request, Response } from 'express';
import { PrismaClient, EntityType, DocumentCategory } from '@prisma/client';
import path from 'path';
import { submitCamerfirmaForm } from '../service/camerfirmaAutomation';

const prisma = new PrismaClient() as any;

/**
 * 1. REGISTRO INICIAL: Crea el borrador en estado EN_REVISION y guarda los documentos.
 */
export const handleVerifyDni = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const {
      documentNumber,
      email,
      phone,
      useTempEmail,
      entityType,
      planType,
      companyRuc,
      companyName,
      rucType,
    } = req.body;

    const isTempEmailEnabled = useTempEmail === undefined ? true : (useTempEmail === 'true' || useTempEmail === true);

    const isEmpresa = entityType === 'EMPRESA' || entityType === 'company';
    const finalEntityType: EntityType = isEmpresa ? EntityType.EMPRESA : EntityType.PERSONA_NATURAL;

    const rawNames = req.body.applicantNames || 'Titular';
    const rawSurname1 = req.body.applicantSurname1 || '';
    const rawSurname2 = req.body.applicantSurname2 || '';

    const newRequest = await prisma.certificateRequest.create({
      data: {
        code: `CERT-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        userId: req.user.id,
        entityType: finalEntityType,
        planType: planType || 'ONE_SHOT',
        status: 'EN_REVISION',
        progress: isEmpresa ? '1/3' : '1/1',

        applicantDocNum: documentNumber || '',
        applicantEmail: email || '',
        useTempEmail: isTempEmailEnabled,
        applicantPhone: phone || '',
        applicantNames: rawNames,
        applicantSurname1: rawSurname1,
        applicantSurname2: rawSurname2,

        companyRuc: isEmpresa ? companyRuc : null,
        companyName: isEmpresa ? companyName : null,
        rucType: isEmpresa ? rucType : null,
      },
    });

    const firstNames = String(rawNames).trim().toUpperCase();
    const lastNames = `${rawSurname1} ${rawSurname2}`.trim().toUpperCase();
    const fullName = `${firstNames} ${lastNames}`.trim().toUpperCase();

    if (documentNumber) {
      await prisma.verificationRequest.create({
        data: {
          userId: req.user.id,
          entityType: finalEntityType,
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

    const documentsToCreate = [];

    if (files?.file?.[0]) {
      documentsToCreate.push({
        requestId: newRequest.id,
        category: DocumentCategory.DNI_FRONT_BACK,
        fileName: files.file[0].originalname,
        fileUrl: `/uploads/${files.file[0].filename}`,
        mimeType: files.file[0].mimetype,
      });
    } else if (files?.fileDni?.[0]) {
      documentsToCreate.push({
        requestId: newRequest.id,
        category: DocumentCategory.DNI_FRONT_BACK,
        fileName: files.fileDni[0].originalname,
        fileUrl: `/uploads/${files.fileDni[0].filename}`,
        mimeType: files.fileDni[0].mimetype,
      });
    }

    if (isEmpresa && files?.fileRuc?.[0]) {
      documentsToCreate.push({
        requestId: newRequest.id,
        category: DocumentCategory.FICHA_RUC,
        fileName: files.fileRuc[0].originalname,
        fileUrl: `/uploads/${files.fileRuc[0].filename}`,
        mimeType: files.fileRuc[0].mimetype,
      });
    }

    if (isEmpresa && files?.fileVigencia?.[0]) {
      documentsToCreate.push({
        requestId: newRequest.id,
        category: DocumentCategory.VIGENCIA_PODER,
        fileName: files.fileVigencia[0].originalname,
        fileUrl: `/uploads/${files.fileVigencia[0].filename}`,
        mimeType: files.fileVigencia[0].mimetype,
      });
    }

    if (documentsToCreate.length > 0) {
      await prisma.requestDocument.createMany({
        data: documentsToCreate,
      });
    }

    const savedRequest = await prisma.certificateRequest.findUnique({
      where: { id: newRequest.id },
      include: { documents: true },
    });

    return res.status(201).json({ data: savedRequest });
  } catch (error: any) {
    console.error('Error al crear certificado:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
};

/**
 * 2. ENVÍO EXTERNO: Se gatilla cuando el expediente se revisa desde el detalle (/certificates/[id]).
 */
export const handleSendToCamerfirma = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const certRequest = await prisma.certificateRequest.findUnique({
      where: { id: String(id) },
      include: { documents: true },
    });

    if (!certRequest) {
      return res.status(404).json({ error: 'Solicitud de certificado no encontrada' });
    }

    const isEmpresa = certRequest.entityType === 'EMPRESA';

    const dniDoc = certRequest.documents.find((d: any) => d.category === DocumentCategory.DNI_FRONT_BACK);
    const rucDoc = certRequest.documents.find((d: any) => d.category === DocumentCategory.FICHA_RUC);
    const vigenciaDoc = certRequest.documents.find((d: any) => d.category === DocumentCategory.VIGENCIA_PODER);

    const getAbsolutePath = (fileUrl?: string) => {
      if (!fileUrl) return undefined;
      return path.join(process.cwd(), 'public', fileUrl);
    };

    // 🎯 Determinar el correo inyectado: Si se usa modo pruebas con Gmail, toma GMAIL_USER de .env
    const injectedEmail = certRequest.useTempEmail !== false
      ? (process.env.GMAIL_USER || certRequest.applicantEmail)
      : certRequest.applicantEmail;

    // 3. Ejecutar la automatización de Playwright
    const automationResult = await submitCamerfirmaForm({
      entityType: isEmpresa ? 'EMPRESA' : 'PERSONA_NATURAL',
      documentNumber: certRequest.applicantDocNum,
      firstNames: certRequest.applicantNames,
      lastName1: certRequest.applicantSurname1,
      lastName2: certRequest.applicantSurname2,
      email: injectedEmail,
      phone: certRequest.applicantPhone,
      
      companyRuc: certRequest.companyRuc || undefined,
      companyName: certRequest.companyName || undefined,
      cargo: 'REPRESENTANTE LEGAL',

      fileDniPath: getAbsolutePath(dniDoc?.fileUrl),
      fileRucPath: getAbsolutePath(rucDoc?.fileUrl),
      fileVigenciaPath: getAbsolutePath(vigenciaDoc?.fileUrl),
    });

    const updatedRequest = await prisma.certificateRequest.update({
      where: { id: String(id) },
      data: { status: 'APROBADO' },
    });

    return res.status(200).json({
      message: 'Expediente enviado a Camerfirma y verificado con éxito',
      result: automationResult,
      data: updatedRequest,
    });

  } catch (error: any) {
    console.error('Error al procesar envío externo a Camerfirma:', error);
    return res.status(500).json({
      error: 'Error al ejecutar la automatización en Camerfirma',
      details: error.message || 'Fallo desconocido',
    });
  }
};