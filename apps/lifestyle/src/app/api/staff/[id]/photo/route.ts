// ─── API: Staff Photo Upload ───────────────────────────────────────────────────
// POST /api/staff/[id]/photo
//   Recibe multipart/form-data con campo 'file'.
//   - Verifica auth — owner o admin del mismo business_id.
//   - Verifica que staff.[id] pertenece al business_id del admin.
//   - Valida: solo image/jpeg|png|webp, máx 2MB.
//   - Nombre: {business_id}/{staff_id}.{ext} — sobreescribe si ya existe.
//   - Sube a bucket 'staff-photos' con service_role_key.
//   - UPDATE staff SET photo_url = publicUrl.
//   - Retorna { photo_url: string }.
//
// DELETE /api/staff/[id]/photo
//   - Elimina el archivo del Storage (todos los ext posibles, best-effort).
//   - UPDATE staff SET photo_url = NULL.
//   - Retorna { photo_url: null }.

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwnerOrAdmin } from '@/lib/auth';

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

const ALLOWED_MIME = new Set(Object.keys(MIME_TO_EXT));

// ─── Service client ───────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createServiceClient(url, key);
}

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const StaffIdSchema = z.string().uuid('ID de staff inválido');

// ─── Tipos internos ───────────────────────────────────────────────────────────

type TargetStaffRow = {
  id: string;
  business_id: string;
};

// ─── Helper: verificar que el staff target pertenece al negocio ───────────────

async function getTargetStaff(
  staffId: string,
  businessId: string,
): Promise<TargetStaffRow | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('staff')
    .select('id, business_id')
    .eq('id', staffId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (error || !data) return null;
  return data as TargetStaffRow;
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Auth: owner o admin del negocio (token o Supabase Auth)
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // 2. Validar params
  const { id: rawId } = await params;
  const parsedId = StaffIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json({ error: parsedId.error.issues[0]?.message ?? 'ID inválido' }, { status: 400 });
  }
  const staffId = parsedId.data;

  // 3. Verificar que el staff target pertenece al mismo negocio
  const target = await getTargetStaff(staffId, auth.businessId);
  if (!target) return NextResponse.json({ error: 'Staff no encontrado' }, { status: 404 });

  // 5. Parsear multipart/form-data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Formato de request inválido' }, { status: 400 });
  }

  const fileField = formData.get('file');
  if (!(fileField instanceof File)) {
    return NextResponse.json({ error: "Campo 'file' requerido" }, { status: 400 });
  }

  // 6. Validar tipo MIME
  if (!ALLOWED_MIME.has(fileField.type)) {
    return NextResponse.json(
      { error: 'Tipo no permitido. Solo JPEG, PNG o WebP.' },
      { status: 422 },
    );
  }

  // 7. Validar tamaño
  if (fileField.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: 'Archivo demasiado grande. Máximo 2MB.' },
      { status: 422 },
    );
  }

  // 8. Construir path: {business_id}/{staff_id}.{ext}
  const ext = MIME_TO_EXT[fileField.type];
  if (!ext) {
    return NextResponse.json({ error: 'Tipo no soportado' }, { status: 422 });
  }
  const storagePath = `${auth.businessId}/${staffId}.${ext}`;

  // 9. Subir a Storage (upsert sobreescribe el archivo anterior)
  const supabase = getAdminClient();
  const buffer = await fileField.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('staff-photos')
    .upload(storagePath, buffer, {
      contentType: fileField.type,
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: 'Error al subir la imagen' }, { status: 500 });
  }

  // 10. Obtener URL pública
  const { data: { publicUrl } } = supabase.storage
    .from('staff-photos')
    .getPublicUrl(storagePath);

  // 11. Actualizar staff.photo_url
  const { error: updateError } = await supabase
    .from('staff')
    .update({ photo_url: publicUrl })
    .eq('id', staffId);

  if (updateError) {
    return NextResponse.json({ error: 'Error al guardar URL de foto' }, { status: 500 });
  }

  return NextResponse.json({ photo_url: publicUrl });
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  void request;

  // 1. Auth: owner o admin del negocio (token o Supabase Auth)
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // 2. Validar params
  const { id: rawId } = await params;
  const parsedId = StaffIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json({ error: parsedId.error.issues[0]?.message ?? 'ID inválido' }, { status: 400 });
  }
  const staffId = parsedId.data;

  // 3. Verificar que el staff target pertenece al mismo negocio
  const target = await getTargetStaff(staffId, auth.businessId);
  if (!target) return NextResponse.json({ error: 'Staff no encontrado' }, { status: 404 });

  // 5. Eliminar de Storage — todos los ext posibles, best-effort
  // Se eliminan todos porque al cambiar el tipo de archivo puede quedar
  // un archivo con ext anterior en Storage.
  const supabase = getAdminClient();
  const paths = Object.values(MIME_TO_EXT).map(
    (ext) => `${auth.businessId}/${staffId}.${ext}`,
  );
  await supabase.storage.from('staff-photos').remove(paths);

  // 6. Limpiar photo_url en DB
  const { error: updateError } = await supabase
    .from('staff')
    .update({ photo_url: null })
    .eq('id', staffId);

  if (updateError) {
    return NextResponse.json({ error: 'Error al eliminar foto' }, { status: 500 });
  }

  return NextResponse.json({ photo_url: null });
}
