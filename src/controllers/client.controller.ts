import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

interface DocumentItem {
  id: string;
  type: string;
  fileUrl: string;
}

export const getClientDataForInjector = async (req: Request, res: Response) => {
  // Garantizar que id sea un string
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!id) {
    return res.status(400).json({ error: 'ID de certificado no proporcionado' });
  }

  try {
    // Consulta directa sin 'include' conflictivo
    const cert = await prisma.certificateRequest.findUnique({
      where: { id },
    });

    if (!cert) {
      return res.status(404).json({ error: 'Certificado no encontrado' });
    }

    // Cast seguro a 'any' para extraer campos opcionales o dinámicos sin errores de compilación
    const certData = cert as any;

    const payload = {
      nombre: certData.applicantNames || '',
      primerApellido: certData.applicantSurname1 || '',
      segundoApellido: certData.applicantSurname2 || '',
      tipoDocIdentificativo: certData.applicantDocType === 'DNI' ? 'DNI' : certData.applicantDocType,
      numDoc: certData.applicantDocNum || '',
      email: certData.applicantEmail || '',
      telefono: certData.applicantPhone || '',
      departamento: certData.department || certData.departmentName || 'LIMA',
      provincia: certData.province || certData.provinceName || 'LIMA',
      distrito: certData.district || certData.districtName || 'LIMA',
      direccion: certData.address || certData.street || '',
      codigoPostal: certData.postalCode || certData.zipCode || '15001',
      documentosAportar: [
        { 
          tipoCamerfirma: 'DNI-NIE-NIF', 
          url: certData.documents?.find((d: DocumentItem) => d.type === 'DNI')?.fileUrl || certData.dniUrl 
        },
        { 
          tipoCamerfirma: 'VPI', 
          url: certData.documents?.find((d: DocumentItem) => d.type === 'RUC')?.fileUrl || certData.rucUrl 
        },
        { 
          tipoCamerfirma: 'PODERES', 
          url: certData.documents?.find((d: DocumentItem) => d.type === 'PODER')?.fileUrl || certData.powerUrl 
        },
      ].filter((doc) => doc.url)
    };

    res.setHeader('Access-Control-Allow-Origin', 'https://secure.camerfirma.com/solicitudes_status/solicitud_1.php?codpro=PXBEOYHS&num_perfil=13040');
    return res.json(payload);
  } catch (error: any) {
    return res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
};