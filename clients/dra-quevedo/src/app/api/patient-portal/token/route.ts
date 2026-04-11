// ─── POST /api/patient-portal/token ───────────────────────────────────────────
// Genera un token JWT de portal del paciente dado su número de teléfono.
// Llamado por el bot internamente — nunca exponer al navegador del paciente.
//
// Autenticación: header x-cron-secret debe coincidir con CRON_SECRET env var.
// Si el paciente no existe: retorna 404 sin revelar información útil al caller.
// TTL del token: 7 días.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { generatePatientPortalToken } from '@presenciapro/engine/portal';
import { clientConfig } from '@/config/client.config';

// ─── Schema ───────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  whatsappId: z.string().min(1),
});

// ─── Row shapes ───────────────────────────────────────────────────────────────

type PatientRow = {
  id: string;
};

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  // Guard: autenticación del bot/cron
  const cronSecret = request.headers.get('x-cron-secret');
  if (!process.env['CRON_SECRET'] || cronSecret !== process.env['CRON_SECRET']) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Guard: validar body
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  // Guard: variables de entorno requeridas
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const clientId = clientConfig.client.id;

  // ── Buscar al paciente por teléfono + clientId ────────────────────────────
  const { data: patientRow } = await supabase
    .from('patients')
    .select('id')
    .eq('client_id', clientId)
    .eq('whatsapp_id', body.whatsappId)
    .maybeSingle<PatientRow>();

  // Guard: paciente no encontrado — 404 genérico sin revelar detalles
  if (!patientRow) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // ── Generar token de portal ───────────────────────────────────────────────
  const token = generatePatientPortalToken(patientRow.id, clientId);

  return NextResponse.json({ token });
}
