// ─── POST /api/notifications/reactivation ────────────────────────────────────
// Envía mensajes de reactivación a pacientes candidatos:
//   - last_visit > reactivationDays días atrás
//   - Sin citas futuras activas
//   - Sin reactivación enviada en los últimos reactivationDays días (idempotencia)
// Llamado por la Edge Function dispatch-reactivation (lunes 10:00 CDMX).
// Solo accesible con CRON_SECRET.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsApp, getEffectiveReactivationDays } from '@presenciapro/engine/notifications';
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
  id:         string;
  phone:      string;
  name:       string | null;
  last_visit: string;  // ISO 8601
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

  const clientId        = clientConfig.client.id;
  const reactivationMsg = clientConfig.postConsulta.reactivationMessage;

  const now = new Date();

  // Cutoff mínimo: el menor followUpDays de todos los servicios (o global si es menor).
  // Usamos el mínimo para que la query DB sea inclusiva; el filtro por servicio
  // se aplica por paciente en el paso 4.
  const globalDays    = clientConfig.postConsulta.reactivationDays;
  const allDays       = [
    globalDays,
    ...clientConfig.services
      .map((s) => s.followUpDays)
      .filter((d): d is number => d !== undefined),
  ];
  const minDays  = Math.min(...allDays);
  const dbCutoff = new Date(now.getTime() - minDays * 24 * 60 * 60_000);

  // Ventana de idempotencia: usar el global para no re-enviar demasiado pronto
  const idempWindow = new Date(now.getTime() - globalDays * 24 * 60 * 60_000);

  // ── 1. Candidatos: last_visit > minDays días ──────────────────────────────
  const { data: candidates, error: candidatesError } = await supabase
    .from('patients')
    .select('id, phone, name, last_visit')
    .eq('client_id', clientId)
    .lt('last_visit', dbCutoff.toISOString())
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

  // ── 4. Filtrar elegibles (excluir activos y con reactivación reciente) ────
  const potentiallyEligible = (candidates as PatientRow[]).filter(
    (p) => !activePatientIds.has(p.id) && !recentPhones.has(p.phone),
  );

  if (potentiallyEligible.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  // ── 5. Aplicar followUpDays por servicio de la última cita ────────────────
  // Para cada candidato, obtener el serviceId de su última cita completada
  // y calcular el umbral de reactivación efectivo.
  const patientIds = potentiallyEligible.map((p) => p.id);

  const { data: lastAppointmentRows } = await supabase
    .from('appointments')
    .select('patient_id, service_id, starts_at')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .in('patient_id', patientIds)
    .order('starts_at', { ascending: false });

  // Índice: patient_id → last service_id
  const lastServiceByPatient = new Map<string, string>();
  for (const row of lastAppointmentRows ?? []) {
    const r = row as { patient_id: string; service_id: string };
    if (!lastServiceByPatient.has(r.patient_id)) {
      lastServiceByPatient.set(r.patient_id, r.service_id);
    }
  }

  // Filtro final: aplicar días efectivos por servicio
  // Un paciente es elegible si su last_visit es ANTERIOR al cutoff efectivo.
  // Ej: botox con followUpDays=120 → solo elegible si last_visit > 120 días atrás.
  const eligible = potentiallyEligible.filter((p) => {
    const effectiveDays = getEffectiveReactivationDays(
      clientConfig,
      lastServiceByPatient.get(p.id),
    );
    const patientCutoff = new Date(now.getTime() - effectiveDays * 24 * 60 * 60_000);
    return new Date(p.last_visit) < patientCutoff;
  });

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  // ── 6. Enviar y registrar ─────────────────────────────────────────────────
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
