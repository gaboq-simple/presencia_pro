// ─── GET + PATCH /api/staff/[id]/schedule ────────────────────────────────────
// Reemplaza el horario base recurrente de un barbero.
//
// Body JSON:
//   {
//     availability: Array<{
//       day_of_week: number,   // 0-6 (0=domingo)
//       start_time:  string,   // "HH:MM"
//       end_time:    string    // "HH:MM"
//     }>
//   }
//
// Operación: DELETE todos los registros del staff_id + INSERT los nuevos.
// Días no incluidos en el array = día de descanso (no se insertan).
//
// Auth: getCurrentSession() — roles owner | admin.
//   El staff target debe pertenecer al mismo business_id de la sesión.
//   Sesiones de organización bloqueadas (igual que /manage).
//
// Post: invalidateBusinessCache(businessId).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getCurrentSession } from '@/lib/auth';
import { invalidateBusinessCache } from '@presenciapro/engine/bot';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const StaffIdSchema = z.string().uuid('ID de staff invalido');

const TimeSchema = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  'Hora invalida — usar formato HH:MM',
);

const DaySlotSchema = z.object({
  day_of_week:  z.number().int().min(0).max(6, 'day_of_week debe ser 0-6'),
  start_time:   TimeSchema,
  end_time:     TimeSchema,
  break_start:  TimeSchema.nullable().optional(),
  break_end:    TimeSchema.nullable().optional(),
  is_active:    z.boolean().optional().default(true),
}).refine(
  (d) => d.start_time < d.end_time,
  { message: 'start_time debe ser anterior a end_time', path: ['end_time'] },
).refine(
  (d) => {
    const hasStart = d.break_start != null;
    const hasEnd   = d.break_end   != null;
    return hasStart === hasEnd;
  },
  { message: 'break_start y break_end deben venir juntos o ninguno', path: ['break_end'] },
).refine(
  (d) => {
    if (d.break_start == null || d.break_end == null) return true;
    return d.break_start < d.break_end;
  },
  { message: 'break_start debe ser anterior a break_end', path: ['break_end'] },
);

const BodySchema = z.object({
  availability: z
    .array(DaySlotSchema)
    .max(7, 'Maximo 7 dias por semana')
    .refine(
      (slots) => {
        const days = slots.map((s) => s.day_of_week);
        return new Set(days).size === days.length;
      },
      { message: 'No puede haber dias duplicados' },
    ),
});

// ─── GET ──────────────────────────────────────────────────────────────────────
// Retorna la disponibilidad recurrente actual del staff.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 });
  }

  if (session.type === 'organization') {
    return NextResponse.json(
      { error: 'Usa el token de sucursal' },
      { status: 403 },
    );
  }

  const businessId = session.business_id;
  const { id: rawId } = await params;
  const parsedId = StaffIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json({ error: 'ID invalido' }, { status: 400 });
  }
  const staffId = parsedId.data;

  const supabase = getServiceClient();

  // Verificar que el staff pertenece al negocio de la sesion
  const { data: existing } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Staff no encontrado' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('staff_availability')
    .select('day_of_week, start_time, end_time, break_start, break_end, is_active')
    .eq('staff_id', staffId)
    .order('day_of_week');

  if (error) {
    return NextResponse.json({ error: 'Error al obtener horario' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Auth
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 });
  }

  if (session.type === 'organization') {
    return NextResponse.json(
      { error: 'Usa el token de sucursal para gestionar horarios' },
      { status: 403 },
    );
  }

  const businessId = session.business_id;

  // 2. Validar staff ID del path
  const { id: rawId } = await params;
  const parsedId = StaffIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: parsedId.error.issues[0]?.message ?? 'ID invalido' },
      { status: 400 },
    );
  }
  const staffId = parsedId.data;

  // 3. Validar body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalido' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos invalidos' },
      { status: 400 },
    );
  }

  const { availability } = parsed.data;

  // 4. Verificar que el staff pertenece al negocio de la sesion
  const supabase = getServiceClient();
  const { data: existing, error: fetchError } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Staff no encontrado' }, { status: 404 });
  }

  // 5. DELETE todos los registros actuales del staff
  const { error: deleteError } = await supabase
    .from('staff_availability')
    .delete()
    .eq('staff_id', staffId);

  if (deleteError) {
    return NextResponse.json(
      { error: 'Error al limpiar horario anterior' },
      { status: 500 },
    );
  }

  // 6. INSERT los nuevos dias (puede ser array vacio — descanso total)
  if (availability.length > 0) {
    const rows = availability.map((slot) => ({
      staff_id:    staffId,
      day_of_week: slot.day_of_week,
      start_time:  slot.start_time,
      end_time:    slot.end_time,
      break_start: slot.break_start ?? null,
      break_end:   slot.break_end   ?? null,
      is_active:   slot.is_active   ?? true,
    }));

    const { error: insertError } = await supabase
      .from('staff_availability')
      .insert(rows);

    if (insertError) {
      return NextResponse.json(
        { error: 'Error al guardar horario' },
        { status: 500 },
      );
    }
  }

  // 7. Invalidar cache del bot
  invalidateBusinessCache(businessId);

  return NextResponse.json({ ok: true, days_saved: availability.length });
}
