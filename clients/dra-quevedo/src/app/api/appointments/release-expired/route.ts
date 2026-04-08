// ─── POST /api/appointments/release-expired ───────────────────────────────────
// Libera slots de citas en pending_confirmation cuya ventana de confirmación
// ya venció. Llamado cada 5 min por la Edge Function release-expired-slots.
// Sin body requerido. Solo accesible con CRON_SECRET.
// Retorna { released: number }.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cancelAppointment } from '@presenciapro/engine/scheduling';
import type { GoogleCredentials, AppointmentDeps } from '@presenciapro/engine/scheduling';
import { clientConfig } from '@/config/client.config';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: Request): boolean {
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const googleClientId = process.env['GOOGLE_CLIENT_ID'];
  const googleSecret   = process.env['GOOGLE_CLIENT_SECRET'];
  const googleRefresh  = process.env['GOOGLE_REFRESH_TOKEN'];

  if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleSecret || !googleRefresh) {
    return NextResponse.json({ error: 'missing env vars' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const credentials: GoogleCredentials = {
    clientId: googleClientId,
    clientSecret: googleSecret,
    refreshToken: googleRefresh,
  };
  const deps: AppointmentDeps = { supabase, credentials, config: clientConfig };

  // ── Calcular umbral de expiración desde confirmationWindowHours ───────────
  const windowHours = clientConfig.scheduling.confirmationWindowHours;
  const threshold = new Date(Date.now() - windowHours * 60 * 60_000);

  // ── Buscar citas vencidas ─────────────────────────────────────────────────
  // Usa el índice idx_appointments_pending_confirmation (migración 010)
  const { data: expired, error } = await supabase
    .from('appointments')
    .select('id, starts_at, patient_id, specialist_id')
    .eq('client_id', clientConfig.client.id)
    .eq('status', 'pending_confirmation')
    .lt('created_at', threshold.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (expired ?? []) as Array<{
    id: string;
    starts_at: string;
    patient_id: string;
    specialist_id: string;
  }>;

  let released = 0;

  for (const row of rows) {
    try {
      // ── 1. Cancelar: DB + Google Calendar ──────────────────────────────
      await cancelAppointment(
        {
          appointmentId: row.id,
          clientId: clientConfig.client.id,
          reason: 'confirmation_timeout',
        },
        deps,
      );

      // ── 2. Cancelar scheduled_notifications pendientes ─────────────────
      await supabase
        .from('scheduled_notifications')
        .update({
          sent_at: new Date().toISOString(),
          error_message: 'cancelled — appointment cancelled',
        })
        .eq('appointment_id', row.id)
        .is('sent_at', null)
        .is('failed_at', null);

      released++;
    } catch {
      // Una cita fallida no bloquea las demás — el cron reintenta en 5 min
    }
  }

  return NextResponse.json({ released });
}
