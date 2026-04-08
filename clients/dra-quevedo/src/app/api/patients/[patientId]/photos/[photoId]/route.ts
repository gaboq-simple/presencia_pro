// ─── API Route: DELETE /api/patients/[patientId]/photos/[photoId] ─────────────
// Removes a single photo: deletes from Storage first, then from the DB.
// Auth:    active Supabase Auth session (doctor-facing).
// Profile: medical only.

import { createClient } from '@supabase/supabase-js';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';

type PhotoRow = {
  storage_path: string;
  client_id: string;
  patient_id: string;
};

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ patientId: string; photoId: string }> },
): Promise<Response> {
  if (!isMedical(clientConfig)) return json({ error: 'Not available for this profile' }, 403);

  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey        = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Server configuration error' }, 500);

  // Guard: active doctor session
  const authHeader = request.headers.get('Authorization') ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const { patientId, photoId } = await params;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Fetch the record to get storage_path ──────────────────────────────────
  // Also verifies client_id + patient_id ownership before deleting.
  const { data, error: fetchError } = await supabase
    .from('patient_photos')
    .select('storage_path, client_id, patient_id')
    .eq('id', photoId)
    .eq('client_id', clientConfig.client.id)
    .eq('patient_id', patientId)
    .maybeSingle();

  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!data)      return json({ error: 'Photo not found' }, 404);

  const row = data as PhotoRow;

  // ── Delete from Storage ────────────────────────────────────────────────────
  const { error: storageError } = await supabase.storage
    .from('patient-photos')
    .remove([row.storage_path]);

  if (storageError) return json({ error: `Storage delete failed: ${storageError.message}` }, 500);

  // ── Delete from DB ─────────────────────────────────────────────────────────
  const { error: dbError } = await supabase
    .from('patient_photos')
    .delete()
    .eq('id', photoId)
    .eq('client_id', clientConfig.client.id);

  if (dbError) return json({ error: `DB delete failed: ${dbError.message}` }, 500);

  return json({ deleted: true, photoId }, 200);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
