// ─── API Route: /api/patients/[patientId]/notes ────────────────────────────────
// GET  — devuelve las últimas 5 notas operativas del paciente (o todas con ?all=true).
// POST — agrega una nueva nota operativa. Las notas son inmutables: sin PUT ni DELETE.
//
// Notas operativas: observaciones de gestión del médico (preferencias, recordatorios,
// logística). No son clínicas ni diagnósticos.
//
// Auth:    sesión activa de Supabase Auth (médico).
// Scope:   client_id de esta instancia — nunca mezcla datos entre clientes.
// Perfil:  solo disponible en perfil `medical`.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';
import type { PatientNote } from '@presenciapro/engine/dashboard';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const PostBodySchema = z.object({
  body: z.string().min(1).max(500),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type NoteRow = {
  id: string;
  patient_id: string;
  body: string;
  created_at: string;
};

function rowToNote(row: NoteRow): PatientNote {
  return {
    id:        row.id,
    patientId: row.patient_id,
    body:      row.body,
    createdAt: row.created_at,
  };
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getAuthenticatedUser(request: Request) {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey     = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl || !anonKey) return null;

  const authHeader = request.headers.get('Authorization') ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await anonClient.auth.getUser();
  if (error || !user) return null;

  return user;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  // Guard: solo perfil medical
  if (!isMedical(clientConfig)) {
    return json({ error: 'Not available for this profile' }, 403);
  }

  // Guard: env vars requeridas
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server configuration error' }, 500);
  }

  // Guard: sesión activa del médico
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { patientId } = await params;
  if (!patientId) {
    return json({ error: 'Missing patientId' }, 400);
  }

  const clientId = clientConfig.client.id;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const fetchAll = new URL(request.url).searchParams.get('all') === 'true';

  // Guard: verificar que el paciente pertenece a este client_id
  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id')
    .eq('id', patientId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (patientError || !patient) {
    return json({ error: 'Patient not found' }, 404);
  }

  // Fetch notas ordenadas por más reciente primero
  let query = supabase
    .from('patient_notes')
    .select('id, patient_id, body, created_at')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });

  if (!fetchAll) {
    query = query.limit(5);
  }

  const { data: rows, error: notesError, count } = await supabase
    .from('patient_notes')
    .select('id, patient_id, body, created_at', { count: 'exact' })
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(fetchAll ? 1000 : 5);

  if (notesError) {
    return json({ error: 'Failed to fetch notes' }, 500);
  }

  const notes: PatientNote[] = (rows as NoteRow[] ?? []).map(rowToNote);
  const total = count ?? notes.length;

  return json({ notes, total }, 200);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  // Guard: solo perfil medical
  if (!isMedical(clientConfig)) {
    return json({ error: 'Not available for this profile' }, 403);
  }

  // Guard: env vars requeridas
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server configuration error' }, 500);
  }

  // Guard: sesión activa del médico
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { patientId } = await params;
  if (!patientId) {
    return json({ error: 'Missing patientId' }, 400);
  }

  // Guard: validar body con Zod
  let parsedBody: z.infer<typeof PostBodySchema>;
  try {
    parsedBody = PostBodySchema.parse(await request.json());
  } catch {
    return json({ error: 'Invalid request body — body debe ser texto de 1 a 500 caracteres' }, 400);
  }

  const clientId = clientConfig.client.id;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Guard: verificar que el paciente pertenece a este client_id
  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id')
    .eq('id', patientId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (patientError || !patient) {
    return json({ error: 'Patient not found' }, 404);
  }

  // Insertar nota — sin UPDATE ni DELETE (inmutable por diseño)
  const { data: inserted, error: insertError } = await supabase
    .from('patient_notes')
    .insert({
      client_id:  clientId,
      patient_id: patientId,
      created_by: user.id,
      body:       parsedBody.body.trim(),
    })
    .select('id, patient_id, body, created_at')
    .single();

  if (insertError || !inserted) {
    return json({ error: 'Failed to save note' }, 500);
  }

  const note = rowToNote(inserted as NoteRow);
  return json(note, 201);
}
