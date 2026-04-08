// ─── POST /api/notifications/reactivation ────────────────────────────────────
// Envía mensajes de reactivación a pacientes candidatos:
//   - last_visit > reactivationDays días atrás
//   - Sin citas futuras activas
//   - Sin reactivación enviada en los últimos reactivationDays días (idempotencia)
// Llamado por la Edge Function dispatch-reactivation (lunes 10:00 CDMX).
// Solo accesible con CRON_SECRET.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsApp } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';
import { clientConfig } from '@/config/client.config';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: Request): boolean {
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatientRow {
  id:   string;
  phone: string;
  name: string | null;
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const accountSid     = process.env['WHATSAPP_ACCOUNT_SID'];
  const authToken      = process.env['WHATSAPP_AUTH_TOKEN'];
  const fromNumber     = process.env['WHATSAPP_FROM_NUMBER'];

  if (!supabaseUrl || !serviceRoleKey || !accountSid || !authToken || !fromNumber) {
    return NextResponse.json({ error: 'missing env vars' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const whatsappCreds: WhatsAppCredentials = { accountSid, authToken, fromNumber };

  const clientId         = clientConfig.client.id;
  const reactivationDays = clientConfig.postConsulta.reactivationDays;
  const reactivationMsg  = clientConfig.postConsulta.reactivationMessage;

  const now         = new Date();
  const cutoff      = new Date(now.getTime() - reactivationDays * 24 * 60 * 60_000);
  const idempWindow = new Date(now.getTime() - reactivationDays * 24 * 60 * 60_000);

  // ── 1. Candidatos: last_visit > reactivationDays días ────────────────────
  const { data: candidates, error: candidatesError } = await supabase
    .from('patients')
    .select('id, phone, name')
    .eq('client_id', clientId)
    .lt('last_visit', cutoff.toISOString())
    .not('last_visit', 'is', null);

  if (candidatesError) {
    return NextResponse.json({ error: candidatesError.message }, { status: 500 });
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  // ── 2. Excluir pacientes con citas futuras activas ────────────────────────
  const { data: activeAppointments } = await supabase
    .from('appointments')
    .select('patient_id')
    .eq('client_id', clientId)
    .in('status', ['pending', 'pending_confirmation', 'confirmed'])
    .gt('starts_at', now.toISOString());

  const activePatientIds = new Set<string>(
    (activeAppointments ?? []).map((a: { patient_id: string }) => a.patient_id),
  );

  // ── 3. Excluir pacientes con reactivación reciente (idempotencia) ─────────
  const { data: recentReactivations } = await supabase
    .from('scheduled_notifications')
    .select('patient_phone')
    .eq('client_id', clientId)
    .is('appointment_id', null)
    .eq('type', 'reactivation')
    .gt('created_at', idempWindow.toISOString());

  const recentPhones = new Set<string>(
    (recentReactivations ?? []).map(
      (r: { patient_phone: string }) => r.patient_phone,
    ),
  );

  // ── 4. Filtrar elegibles ──────────────────────────────────────────────────
  const eligible = (candidates as PatientRow[]).filter(
    (p) => !activePatientIds.has(p.id) && !recentPhones.has(p.phone),
  );

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  // ── 5. Enviar y registrar ─────────────────────────────────────────────────
  let sent = 0;

  for (const patient of eligible) {
    const result = await sendWhatsApp(
      { to: patient.phone, body: reactivationMsg },
      whatsappCreds,
    );

    if (!result.success) {
      console.error(`[reactivation] sendWhatsApp failed for ${patient.id}:`, result.error);
      continue;
    }

    // Registrar como enviado — usado para idempotencia en la próxima ejecución
    await supabase.from('scheduled_notifications').insert({
      client_id:      clientId,
      appointment_id: null,
      patient_phone:  patient.phone,
      patient_email:  null,
      type:           'reactivation',
      channel:        'whatsapp',
      scheduled_for:  now.toISOString(),
      sent_at:        now.toISOString(),
    });

    sent += 1;
  }

  return NextResponse.json({ sent });
}
