// ─── GET | PATCH /api/business/hours ──────────────────────────────────────────
// Edita el horario de atención del negocio (businesses.office_hours jsonb).
//
// SEMÁNTICA: este horario es "de cara al público" — lo muestra la landing
// pública y lo usa el bot para el away-message ("estamos cerrados"). NO controla
// qué se puede reservar (eso depende de staff_availability por-barbero).
//
// Formato (idéntico al que produce el onboarding y leen landing + away-message):
//   office_hours: { "0": {start,end}|null, "1": ..., ..., "6": ... }
//   clave "0".."6" = día de semana (0=domingo, convención JS getDay()).
//   valor null = cerrado ese día. HH:MM, start < end.
//
// GET   → { office_hours }
// PATCH → body { office_hours } (objeto COMPLETO, las 7 claves) → { office_hours }
//
// Auth: requireOwnerOrAdmin (rechaza sin sesión 401, organización 403, otros 403).
// business_id siempre del servidor — nunca del cliente.

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { requireOwnerOrAdmin } from '@/lib/auth';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Schema Zod ───────────────────────────────────────────────────────────────

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida — usar HH:MM');

const DayScheduleSchema = z
  .object({ start: TimeSchema, end: TimeSchema })
  .refine((d) => d.start < d.end, {
    message: 'La apertura debe ser anterior al cierre',
    path: ['end'],
  });

const DayValueSchema = z.union([z.null(), DayScheduleSchema]);

// Las 7 claves "0".."6" son requeridas → el objeto guardado siempre tiene la
// forma exacta que esperan la landing y el away-message.
const OfficeHoursSchema = z.object({
  '0': DayValueSchema,
  '1': DayValueSchema,
  '2': DayValueSchema,
  '3': DayValueSchema,
  '4': DayValueSchema,
  '5': DayValueSchema,
  '6': DayValueSchema,
});

const BodySchema = z.object({ office_hours: OfficeHoursSchema });

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('businesses')
      .select('office_hours')
      .eq('id', auth.businessId)
      .maybeSingle();

    if (error || !data) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    return NextResponse.json({ office_hours: (data as { office_hours: unknown }).office_hours ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('businesses')
      .update({ office_hours: parsed.data.office_hours })
      .eq('id', auth.businessId)
      .select('slug, office_hours')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    // La landing pública es dinámica (sin cache primitives), pero revalidamos su
    // path por robustez — si alguna vez entrara al Full Route Cache, igual refresca.
    const slug = (data as { slug: string }).slug;
    if (slug) revalidatePath(`/${slug}`);

    return NextResponse.json({ office_hours: (data as { office_hours: unknown }).office_hours });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
