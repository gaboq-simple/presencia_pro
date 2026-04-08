// ─── API Route: /api/patients/[patientId]/photos ───────────────────────────────
//
// GET  — Returns all photos for a patient, grouped by appointment.
//        Generates fresh signed URLs (7-day expiry) on every call.
//        Response: { groups: PhotoGroup[] }
//
// POST — Receives a client-compressed JPEG as base64 imageDataUrl.
//        Uploads to Storage → generates signed URL → inserts DB record.
//        Body: { appointmentId, type: 'before'|'after', imageDataUrl, notes? }
//        Response: { photoId, url }
//
// Auth:    active Supabase Auth session (doctor-facing).
// Profile: medical only.
// Storage: patient-photos bucket (private, service_role only).

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';

// ─── Types ─────────────────────────────────────────────────────────────────────

type PhotoRow = {
  id: string;
  appointment_id: string;
  type: 'before' | 'after';
  storage_path: string;
  url: string;
  notes: string | null;
  created_at: string;
};

type Photo = {
  id: string;
  type: 'before' | 'after';
  url: string;
  notes: string | null;
  createdAt: string;
};

type PhotoGroup = {
  appointmentId: string;
  photos: Photo[];
};

// ─── Validation ────────────────────────────────────────────────────────────────

const PostBodySchema = z.object({
  appointmentId: z.string().uuid(),
  type:          z.enum(['before', 'after']),
  /** Client-compressed JPEG as a data URL: "data:image/jpeg;base64,..." */
  imageDataUrl:  z.string().min(1),
  notes:         z.string().min(1).optional(),
});

// ─── Auth helper ───────────────────────────────────────────────────────────────

async function verifySession(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<boolean> {
  const authHeader = request.headers.get('Authorization') ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await anonClient.auth.getUser();
  return !error && user !== null;
}

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  if (!isMedical(clientConfig)) return json({ error: 'Not available for this profile' }, 403);

  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey        = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Server configuration error' }, 500);

  if (!await verifySession(request, supabaseUrl, anonKey)) return json({ error: 'Unauthorized' }, 401);

  const { patientId } = await params;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await supabase
    .from('patient_photos')
    .select('id, appointment_id, type, storage_path, url, notes, created_at')
    .eq('client_id', clientConfig.client.id)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as PhotoRow[];

  // ── Refresh signed URLs (7-day expiry) ──────────────────────────────────────
  const refreshed = await Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from('patient-photos')
        .createSignedUrl(row.storage_path, 60 * 60 * 24 * 7);

      return {
        id:            row.id,
        appointmentId: row.appointment_id,
        type:          row.type,
        url:           signed?.signedUrl ?? row.url,
        notes:         row.notes,
        createdAt:     row.created_at,
      };
    }),
  );

  // ── Group by appointmentId ────────────────────────────────────────────────
  const groupMap = new Map<string, Photo[]>();
  for (const r of refreshed) {
    const group = groupMap.get(r.appointmentId) ?? [];
    group.push({ id: r.id, type: r.type, url: r.url, notes: r.notes, createdAt: r.createdAt });
    groupMap.set(r.appointmentId, group);
  }

  const groups: PhotoGroup[] = Array.from(groupMap.entries()).map(([appointmentId, photos]) => ({
    appointmentId,
    photos,
  }));

  return json({ groups }, 200);
}

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  if (!isMedical(clientConfig)) return json({ error: 'Not available for this profile' }, 403);

  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey        = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Server configuration error' }, 500);

  if (!await verifySession(request, supabaseUrl, anonKey)) return json({ error: 'Unauthorized' }, 401);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);

  const { appointmentId, type, imageDataUrl, notes } = parsed.data;
  const { patientId } = await params;

  // ── Decode base64 data URL ─────────────────────────────────────────────────
  const base64Match = imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!base64Match?.[1]) return json({ error: 'Invalid imageDataUrl format' }, 400);

  const imageBuffer = Buffer.from(base64Match[1], 'base64');

  // ── Build storage path ─────────────────────────────────────────────────────
  // Pattern: {clientId}/{patientId}/{appointmentId}/{type}-{timestamp}.jpg
  const timestamp   = Date.now();
  const storagePath = `${clientConfig.client.id}/${patientId}/${appointmentId}/${type}-${timestamp}.jpg`;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Upload to Storage ──────────────────────────────────────────────────────
  const { error: uploadError } = await supabase.storage
    .from('patient-photos')
    .upload(storagePath, imageBuffer, {
      contentType:  'image/jpeg',
      cacheControl: '3600',
      upsert:       false,
    });

  if (uploadError) return json({ error: `Upload failed: ${uploadError.message}` }, 500);

  // ── Generate signed URL (7 days) ───────────────────────────────────────────
  const { data: signed, error: signError } = await supabase.storage
    .from('patient-photos')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (signError || !signed?.signedUrl) {
    return json({ error: `Failed to sign URL: ${signError?.message ?? 'unknown'}` }, 500);
  }

  // ── Insert DB record ───────────────────────────────────────────────────────
  const { data: inserted, error: dbError } = await supabase
    .from('patient_photos')
    .insert({
      client_id:      clientConfig.client.id,
      patient_id:     patientId,
      appointment_id: appointmentId,
      type,
      storage_path:   storagePath,
      url:            signed.signedUrl,
      notes:          notes ?? null,
    })
    .select('id')
    .single();

  if (dbError || !inserted) return json({ error: `DB insert failed: ${dbError?.message ?? 'unknown'}` }, 500);

  return json({ photoId: (inserted as { id: string }).id, url: signed.signedUrl }, 201);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
