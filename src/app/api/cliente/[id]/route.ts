import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUbigeoDetails } from '../../../utils/postal-codes';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'ID de certificado no proporcionado' }, { status: 400 });
    }

    const cert = await prisma.certificateRequest.findUnique({
      where: { id },
      include: {
        documents: true,
      },
    });

    if (!cert) {
      return NextResponse.json({ error: 'Certificado no encontrado' }, { status: 404 });
    }

    const dept = cert.department || 'ICA';
    const prov = cert.province || 'ICA';
    const dist = cert.district || 'PARCONA';

    const ubigeoInfo = getUbigeoDetails(dept, prov, dist);

    const payload = {
      nombre: cert.applicantNames || '',
      primerApellido: cert.applicantSurname1 || '',
      segundoApellido: cert.applicantSurname2 || '',
      tipoDocIdentificativo: cert.applicantDocType === 'DNI' ? 'DNI' : cert.applicantDocType,
      numDoc: cert.applicantDocNum || '',
      numDocumento: cert.applicantDocNum || '',
      email: cert.applicantEmail || '',
      telefono: cert.applicantPhone || '',
      
      // Datos Ubigeo
      departamento: dept.toUpperCase(),
      provincia: prov.toUpperCase(),
      distrito: dist.toUpperCase(),
      ubigeoDept: ubigeoInfo.codeDept,
      ubigeoProv: ubigeoInfo.codeProv,
      ubigeoDist: ubigeoInfo.codeDist,
      
      direccion: cert.address || '',
      domicilio: cert.address || '',
      codigoPostal: cert.postalCode || ubigeoInfo.postalCode,
      
      documentosAportar: (cert.documents || []).map((doc) => {
        let tipoCamerfirma = 'DNI-NIE-NIF';
        if (doc.category === 'FICHA_RUC') tipoCamerfirma = 'VPI';
        if (doc.category === 'VIGENCIA_PODER') tipoCamerfirma = 'PODERES';

        return {
          tipoCamerfirma,
          url: doc.fileUrl,
        };
      }),
    };

    return NextResponse.json(payload, { status: 200 });

  } catch (error: any) {
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}