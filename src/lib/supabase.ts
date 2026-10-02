import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'certificates-documents';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ Advertencia: Credenciales de Supabase no configuradas en .env');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Sube un archivo a Supabase Storage.
 * Si se pasa un `customPath`, se usa exactamente esa ruta (ideal para reemplazos).
 */
export async function uploadToSupabase(
  file: File, 
  folderOrCustomPath = 'documents'
): Promise<{ fileUrl: string; storagePath: string; buffer: Buffer }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const cleanFileName = file.name.replace(/\s+/g, '_');
  
  // Si ya viene con una ruta completa (contiene '/'), la usamos directamente
  const storagePath = folderOrCustomPath.includes('/')
    ? folderOrCustomPath
    : `${folderOrCustomPath}/${Date.now()}_${cleanFileName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/pdf',
      upsert: true, // 👈 Forzar reemplazo
    });

  if (error) {
    throw new Error(`Error al subir archivo a Supabase: ${error.message}`);
  }

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
 * Descarga temporalmente un archivo desde Supabase a un Buffer
 */
export async function downloadFromSupabase(fileUrlOrPath: string): Promise<Buffer> {
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