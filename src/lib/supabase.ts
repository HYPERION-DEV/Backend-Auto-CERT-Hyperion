// backend-hyperion/src/lib/supabase.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'certificates-documents';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ Advertencia: Credenciales de Supabase no configuradas en .env');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Sube un archivo a Supabase Storage y retorna su URL pública/firmada y path interno.
 */
export async function uploadToSupabase(
  file: File, 
  folder = 'documents'
): Promise<{ fileUrl: string; storagePath: string; buffer: Buffer }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const cleanFileName = file.name.replace(/\s+/g, '_');
  const storagePath = `${folder}/${Date.now()}-${cleanFileName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/pdf',
      upsert: true,
    });

  if (error) {
    throw new Error(`Error al subir archivo a Supabase: ${error.message}`);
  }

  // Obtener la URL pública del archivo
  const { data: publicUrlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(storagePath);

  return {
    fileUrl: publicUrlData.publicUrl,
    storagePath: data.path,
    buffer,
  };
}

/**
 * Descarga temporalmente un archivo desde Supabase a un Buffer (ideal para Puppeteer / OCR)
 */
export async function downloadFromSupabase(fileUrlOrPath: string): Promise<Buffer> {
  // Limpiar Query Parameters si existen
  const cleanUrl = fileUrlOrPath.split('?')[0];
  let storagePath = cleanUrl;

  if (cleanUrl.includes(`${BUCKET_NAME}/`)) {
    storagePath = cleanUrl.split(`${BUCKET_NAME}/`)[1];
  }

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`No se pudo descargar el documento desde Supabase Storage: ${error?.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Elimina un archivo de Supabase Storage mediante su URL o path
 */
export async function deleteFromSupabase(fileUrlOrPath: string): Promise<boolean> {
  try {
    const cleanUrl = fileUrlOrPath.split('?')[0];
    let storagePath = cleanUrl;

    if (cleanUrl.includes(`${BUCKET_NAME}/`)) {
      storagePath = cleanUrl.split(`${BUCKET_NAME}/`)[1];
    }

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([storagePath]);

    if (error) {
      console.error(`Error eliminando archivo de Supabase (${storagePath}):`, error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Excepción al intentar eliminar archivo en Supabase:', err);
    return false;
  }
}