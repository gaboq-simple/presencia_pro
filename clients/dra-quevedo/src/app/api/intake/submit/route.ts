// ─── POST /api/intake/submit ──────────────────────────────────────────────────
// Saves the patient's intake form. Authentication is the signed JWT in the body
// (INTAKE_SECRET) — no CRON_SECRET, no Supabase Auth session required.
// The patient fills this form in the browser via a one-time link from WhatsApp.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { saveIntake, verifyIntakeToken } from '@presenciapro/engine/intake';
import { clientConfig } from '@/config/client.config';

// ─── Schema ───────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  token: z.string().min(1),
  fields: z.record(z.unknown()),
  signatureDataUrl: z.string().optional(),
});

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  // ── Parse and validate body ────────────────────────────────────────────────
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const { token, fields, signatureDataUrl } = body;

  // ── Verify token before touching DB ───────────────────────────────────────
  const decoded = verifyIntakeToken(token);
  if (!decoded) {
    return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
  }

  // Guard: token must be for this client instance
  if (decoded.clientId !== clientConfig.client.id) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  // ── Supabase service role client ───────────────────────────────────────────
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Error de configuración del servidor' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Save intake (idempotent) ───────────────────────────────────────────────
  let intake;
  try {
    intake = await saveIntake({ token, fields, signatureDataUrl, supabase });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    // Guard: re-expose token errors as 401, others as 500
    if (message.includes('Invalid or expired')) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Error al guardar el formulario' }, { status: 500 });
  }

  // ── Mark intake as completed in bot_conversations context ─────────────────
  // Targeted update: set intakeCompleted: true in bot_conversations for this appointment.
  // We join through appointments to get the patient, then match by patient_id.
  // This is best-effort — conversations without intakeCompleted still function correctly.
  try {
    const { data: apptRow } = await supabase
      .from('appointments')
      .select('patient_id')
      .eq('id', decoded.appointmentId)
      .eq('client_id', decoded.clientId)
      .single();

    if (apptRow?.patient_id) {
      const { data: patientRow } = await supabase
        .from('patients')
        .select('phone')
        .eq('id', (apptRow as { patient_id: string }).patient_id)
        .eq('client_id', decoded.clientId)
        .single();

      const phone = (patientRow as { phone: string } | null)?.phone;
      if (phone) {
        const { data: convRow } = await supabase
          .from('bot_conversations')
          .select('id, context')
          .eq('client_id', decoded.clientId)
          .eq('patient_phone', phone)
          .maybeSingle();

        if (convRow) {
          const currentContext = (convRow as { id: string; context: Record<string, unknown> }).context ?? {};
          await supabase
            .from('bot_conversations')
            .update({ context: { ...currentContext, intakeCompleted: true } })
            .eq('id', (convRow as { id: string }).id);
        }
      }
    }
  } catch {
    // Best-effort — intake is already saved, do not fail the response
  }

  return NextResponse.json({
    intakeId: intake.id,
    signedAt: intake.signedAt?.toISOString() ?? null,
  });
}
