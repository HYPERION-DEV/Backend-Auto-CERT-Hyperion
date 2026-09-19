// backend-hyperion/src/app/api/sunat/ruc/[ruc]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ruc: string }> }
) {
  try {
    const { ruc } = await context.params;

    // Validar formato básico de RUC peruano
    if (!/^\d{11}$/.test(ruc) || (!ruc.startsWith('10') && !ruc.startsWith('20'))) {
      return NextResponse.json(
        { error: 'El RUC debe tener 11 dígitos y comenzar con 10 o 20.' },
        { status: 400 }
      );
    }

    // Consulta a OpenRUC
    const response = await fetch(`https://openruc.com/api/ruc/${ruc}`, {
      headers: {
        'Accept': 'application/json',
      },
      // Descomentar si usas un API Key en tus variables de entorno:
      // headers: { 'Authorization': `Bearer ${process.env.OPENRUC_API_TOKEN}` }
    });

    if (response.status === 404) {
      return NextResponse.json(
        { found: false, message: 'No encontramos ese RUC en SUNAT. Escribir la razón social' },
        { status: 404 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { found: false, message: 'Error en la consulta con SUNAT/OpenRUC.' },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      found: true,
      ruc: data.ruc || ruc,
      razonSocial: data.razon_social || data.nombre_o_razon_social || data.nombre,
      estado: data.estado_del_contribuyente || data.estado,
      condicion: data.condicion_de_domicilio || data.condicion,
    });

  } catch (error: any) {
    console.error('Error al consultar OpenRUC:', error);
    return NextResponse.json(
      { found: false, error: 'Error interno del servidor al consultar RUC.' },
      { status: 500 }
    );
  }
}