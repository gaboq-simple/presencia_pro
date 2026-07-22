// ─── Lifestyle Bot — Scheduling ───────────────────────────────────────────────
// getDayAvailability(): fuente ÚNICA de disponibilidad. Calcula la FORMA completa del día
// (all/morning/afternoon, sin truncar) cruzando staff_availability, appointments y
// staff_blocks. Cada consumidor toma `.all` (y, si presenta una lista, `.all.slice(0,3)`).
//
// Round-robin ponderado:
//   1. COUNT(appointments) por staff_id WHERE DATE(starts_at) = fecha solicitada
//      AND status != 'cancelled'
//   2. El barbero con menor count recibe la asignación.
//   3. Si hay empate entre N barberos: Math.random() elige entre ellos.
//
// Modo walk-in:
//   Inicio = NOW() + walkInBufferMinutes.
//   Se busca el slot más cercano disponible desde ese punto.
//   Se devuelve como única opción (array de 1 elemento).

import type { SupabaseClient } from '@supabase/supabase-js';
import { tenantDb } from '../../tenantDb';
import { sendWhatsAppMeta } from '../../notifications/whatsapp';
import type { SlotCandidate, StaffAvailabilityRow, StaffRow } from './types';

/**
 * Error lanzado cuando un query crítico de disponibilidad falla en Supabase.
 * Permite que el caller (presentingSlots) distinga entre "no hay slots"
 * vs "no se pudo verificar disponibilidad" — evitando mensajes falsos de
 * "sin disponibilidad" y riesgo de doble booking.
 */
export class SchedulingQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulingQueryError';
  }
}
import {
  utcToLocalDateStr,
  utcToLocalMinutes,
  localTimeToUTC,
  isSameDayInTZ,
  weekdayFromDateStr,
} from './tzUtils';
import { formatTimeHumanFromDate } from './utils';
import { DAYS_ES, MONTHS_ES } from './copy';

// ─── Constantes ───────────────────────────────────────────────────────────────

const SLOT_INTERVAL_MINUTES = 15;  // granularidad de slots
// El truncado a ≤3 (cap del pendingSlot, schema index.max(3)) vive ahora en cada consumidor
// como `.all.slice(0, 3)` — ya no hay un wrapper getAvailableSlots ni una constante global.
// Corte mañana / tarde-noche para el bucketing de franjas (disponibilidad honesta).
// Constante única del NUEVO bucketing. El filtro de generación (generateSlotsForStaff)
// se alinea a este valor en su propio commit aparte. Exportada: el árbol de
// presentación (slotPresentation.ts) la usa para ubicar la franja de un requestedTime.
export const AFTERNOON_CUTOFF = 14 * 60;  // 14:00 local, en minutos

// ─── Helpers de tiempo ────────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

type AppointmentBlock = { starts_at: string; ends_at: string };
type StaffBlock       = { starts_at: string; ends_at: string };
type ExceptionRow     = { staff_id: string; exception_date: string; available: boolean; start_time: string | null; end_time: string | null };

// ─── Disponibilidad por staff ─────────────────────────────────────────────────

/**
 * Genera candidatos de slots para un staff en una fecha dada.
 * Resta appointments existentes y staff_blocks.
 *
 * @param requestedDateStr  Fecha local del negocio "YYYY-MM-DD"
 * @param requestedDate     Date en noon UTC para la misma fecha (para isSameDayInTZ)
 * @param tz                IANA timezone del negocio
 */
// Exportada (solo visibilidad, sin cambio de comportamiento) para reusarla como
// primitiva de CAPACIDAD en el dashboard del dueño (Negocio · ocupación): capacidad
// = generar los slots con ocupación vacía. Fuente única de "qué es un slot".
export function generateSlotsForStaff(
  staffId: string,
  staffName: string,
  availability: StaffAvailabilityRow,
  requestedDate: Date,
  requestedDateStr: string,
  durationMinutes: number,
  appointments: AppointmentBlock[],
  blocks: StaffBlock[],
  minStart: Date | null,  // para walk-in: NOW() + buffer (UTC absoluto)
  shift: 'morning' | 'afternoon' | null,
  tz: string,
  exception: ExceptionRow | null,
): SlotCandidate[] {
  // Excepción de fecha específica: día libre → sin slots
  if (exception !== null && !exception.available) return [];

  // Si la excepción tiene horario especial, reemplaza el base (y elimina el break)
  const hasSpecialSchedule = exception !== null && exception.start_time !== null;
  const startMinutes = hasSpecialSchedule
    ? timeToMinutes(exception!.start_time!)
    : timeToMinutes(availability.start_time);
  const endMinutes = hasSpecialSchedule
    ? timeToMinutes(exception!.end_time!)
    : timeToMinutes(availability.end_time);

  const slots: SlotCandidate[] = [];

  // Construir ocupaciones en minutos locales desde medianoche (hora del negocio)
  const occupiedRanges: Array<{ start: number; end: number }> = [];
  for (const appt of appointments) {
    const s = new Date(appt.starts_at);
    const e = new Date(appt.ends_at);
    if (!isSameDayInTZ(s, requestedDate, tz)) continue;
    occupiedRanges.push({
      start: utcToLocalMinutes(s, tz),
      end:   utcToLocalMinutes(e, tz),
    });
  }
  for (const block of blocks) {
    const s = new Date(block.starts_at);
    const e = new Date(block.ends_at);
    if (!isSameDayInTZ(s, requestedDate, tz)) continue;
    occupiedRanges.push({
      start: utcToLocalMinutes(s, tz),
      end:   utcToLocalMinutes(e, tz),
    });
  }
  // Break del turno (solo si no hay horario especial por excepción de fecha)
  if (!hasSpecialSchedule && availability.break_start && availability.break_end) {
    occupiedRanges.push({
      start: timeToMinutes(availability.break_start),
      end:   timeToMinutes(availability.break_end),
    });
  }

  // Calcular inicio mínimo en minutos locales desde medianoche
  let minMinutes = startMinutes;
  if (minStart !== null && isSameDayInTZ(minStart, requestedDate, tz)) {
    const minStartMinutes = utcToLocalMinutes(minStart, tz);
    if (minStartMinutes > minMinutes) {
      // Redondear al siguiente múltiplo del intervalo
      minMinutes = Math.ceil(minStartMinutes / SLOT_INTERVAL_MINUTES) * SLOT_INTERVAL_MINUTES;
    }
  }

  // Iterar slots candidatos
  for (
    let slotStart = minMinutes;
    slotStart + durationMinutes <= endMinutes;
    slotStart += SLOT_INTERVAL_MINUTES
  ) {
    const slotEnd = slotStart + durationMinutes;

    // Filtrar por turno si el cliente especificó preferencia. Corte alineado al
    // bucketing de franjas (AFTERNOON_CUTOFF=14:00): mañana = empieza antes de las
    // 14:00; tarde = termina después de las 14:00. Antes 13:00 — la banda 13:00–14:00
    // ahora pertenece a la mañana, consistente con getDayAvailability.
    if (shift === 'morning'   && slotStart >= AFTERNOON_CUTOFF) break;
    if (shift === 'afternoon' && slotEnd   <= AFTERNOON_CUTOFF) continue;

    // Verificar que no colisiona con ninguna ocupación
    const isOccupied = occupiedRanges.some(
      (r) => slotStart < r.end && slotEnd > r.start,
    );
    if (isOccupied) continue;

    // Construir fechas UTC a partir de hora local del negocio
    const hh = String(Math.floor(slotStart / 60)).padStart(2, '0');
    const mm = String(slotStart % 60).padStart(2, '0');
    const hhEnd = String(Math.floor(slotEnd / 60)).padStart(2, '0');
    const mmEnd = String(slotEnd % 60).padStart(2, '0');
    const startsAt = localTimeToUTC(requestedDateStr, `${hh}:${mm}`, tz);
    const endsAt   = localTimeToUTC(requestedDateStr, `${hhEnd}:${mmEnd}`, tz);

    slots.push({ staffId, staffName, startsAt, endsAt });
  }

  return slots;
}

// ─── Round-robin ponderado ────────────────────────────────────────────────────

/**
 * Asigna el staff con menos citas en la fecha solicitada.
 * En empate entre N barberos: Math.random() elige entre ellos.
 */
async function selectStaffRoundRobin(
  businessId: string,
  staffIds: string[],
  requestedDate: Date,
  requestedDateStr: string,
  tz: string,
  supabase: SupabaseClient,
): Promise<string[]> {
  if (staffIds.length === 1) return staffIds;

  // Ventana UTC que cubre el día calendario completo en el timezone del negocio
  const dayStart = localTimeToUTC(requestedDateStr, '00:00', tz);
  const dayEnd   = localTimeToUTC(requestedDateStr, '23:59', tz);

  // COUNT de citas por barbero en la fecha solicitada (excluye canceladas)
  // business_id: defensa en profundidad (MT-03) — los staffIds ya vienen
  // pre-filtrados por negocio; el filtro es no-op para datos correctos.
  const { data } = await tenantDb(supabase, businessId)
    .table('appointments')
    .select('staff_id')
    .in('staff_id', staffIds)
    .gte('starts_at', dayStart.toISOString())
    .lt('starts_at',  dayEnd.toISOString())
    .neq('status', 'cancelled');

  const counts = new Map<string, number>(staffIds.map((id) => [id, 0]));
  for (const row of (data ?? []) as Array<{ staff_id: string }>) {
    counts.set(row.staff_id, (counts.get(row.staff_id) ?? 0) + 1);
  }

  // Encontrar el mínimo de citas
  const minCount = Math.min(...counts.values());

  // Todos los barberos con el mínimo de citas
  const tied = staffIds.filter((id) => (counts.get(id) ?? 0) === minCount);

  // Si hay empate, ordenar aleatoriamente para distribuir carga
  if (tied.length > 1) {
    tied.sort(() => Math.random() - 0.5);
  }

  return tied;
}

// ─── notifyWaitlist ───────────────────────────────────────────────────────────
// Notifica al primer cliente en lista de espera (status='waiting') de un slot
// liberado. Best-effort: el llamador debe envolver en try/catch.
//
// Efectos:
//   1. UPDATE waitlist SET status='notified', notified_at, expires_at
//   2. INSERT scheduled_notification type='waitlist_expiry' (30 min)
//   3. sendWhatsAppMeta al customer — try/catch interno

type WaitlistEntryRow = {
  id: string;
  business_id: string;
  customer: { id: string; name: string; phone: string } | null;
  service:  { name: string } | null;
};

export async function notifyWaitlist(
  waitlistId:    string,
  supabase:      SupabaseClient,
  businessId:    string,   // server-derivado (del caller, ya scopeado por negocio)
  accessToken:   string,
  phoneNumberId: string,
  slotStartsAt:  Date,
  slotStaffId:   string,
  slotStaffName: string,
  tz:            string,
): Promise<void> {
  const db = tenantDb(supabase, businessId);

  // Cargar entry — solo procesar si sigue en 'waiting'. El helper inyecta
  // .eq('business_id') → aunque el waitlistId fuera de otro negocio, no lo ve.
  const { data } = await db
    .table('waitlist')
    .select('id, business_id, customer:customer_id(id, name, phone), service:service_id(name)')
    .eq('id', waitlistId)
    .eq('status', 'waiting')
    .maybeSingle();

  if (!data) return;

  const entry    = data as unknown as WaitlistEntryRow;
  const customer = entry.customer;
  if (!customer) return;

  const notifiedAt = new Date();
  const expiresAt  = new Date(notifiedAt.getTime() + 30 * 60_000);

  // 1. Marcar como notificado
  await db
    .table('waitlist')
    .update({
      status:      'notified',
      notified_at: notifiedAt.toISOString(),
      expires_at:  expiresAt.toISOString(),
    })
    .eq('id', waitlistId);

  // 2. Programar expiración
  await db.table('scheduled_notifications').insert({
    type:          'waitlist_expiry',
    scheduled_for: expiresAt.toISOString(),
    customer_phone: customer.phone,
    customer_id:   customer.id,
    metadata: {
      waitlist_id:    waitlistId,
      slot_starts_at: slotStartsAt.toISOString(),
      slot_staff_id:  slotStaffId,
      slot_staff_name: slotStaffName,
      service_name:   entry.service?.name ?? '',
    },
  });

  // 3. Enviar WhatsApp — best-effort
  try {
    const serviceName = entry.service?.name ?? 'tu servicio';
    const dateStr     = waitlistFormatDate(slotStartsAt, tz);
    const timeStr     = formatTimeHumanFromDate(slotStartsAt, tz);
    const message =
      `Buenas noticias! Se libero un lugar para ${serviceName} ` +
      `el ${dateStr} a las ${timeStr} con ${slotStaffName}\n` +
      `Lo tomamos? Responde SI en los proximos 30 minutos o el lugar se liberara.`;

    await sendWhatsAppMeta(
      { to: customer.phone, body: message },
      { accessToken, phoneNumberId },
    );
  } catch {
    // best-effort — no relanzar
  }
}

// ─── Helpers de formato para notifyWaitlist ───────────────────────────────────

// DAYS_ES/MONTHS_ES viven en copy.ts (AUD-06 — antes 5ª copia local WL_*).

function waitlistFormatDate(d: Date, tz: string): string {
  const localMin = utcToLocalMinutes(d, tz);
  // Obtener componentes de fecha en timezone del negocio
  const localDateStr = utcToLocalDateStr(d, tz);
  const [, , dayStr] = localDateStr.split('-');
  const dayNum  = parseInt(dayStr!, 10);
  const dayOfWeek = weekdayFromDateStr(localDateStr);
  const monthIdx  = parseInt(localDateStr.split('-')[1]!, 10) - 1;
  // suprime warning TS — localMin no se usa en date, es de formato de hora
  void localMin;
  return `${DAYS_ES[dayOfWeek]} ${dayNum} de ${MONTHS_ES[monthIdx]}`;
}

// ─── API pública ──────────────────────────────────────────────────────────────

export type GetAvailableSlotsOptions = {
  businessId: string;
  serviceId: string;
  durationMinutes: number;
  /**
   * Noon UTC Date para la fecha local solicitada.
   * Construir con noonUTCDate(dateStr) desde presentingSlots.ts.
   */
  requestedDate: Date;
  shift: 'morning' | 'afternoon' | null;
  /** Staff específico. Si null → auto_assign con round-robin. */
  preferredStaffId: string | null;
  isWalkIn: boolean;
  walkInBufferMinutes: number;
  staffToQuery: StaffRow[];
  supabase: SupabaseClient;
  /** IANA timezone del negocio. Ej: 'America/Mexico_City'. */
  tz: string;
  /**
   * Hora exacta solicitada en formato "HH:MM".
   * Si presente, los slots se ordenan por cercanía a esa hora (más próximo primero).
   * Si ausente, se ordenan cronológicamente.
   */
  requestedTime?: string;
  /**
   * Estrategia de dedup para auto_assign (preferredStaffId=null). SIN efecto en
   * barbero fijo (que devuelve todos sus slots). Default 'per-barber' = un slot por
   * barbero (comportamiento previo, byte-idéntico — NO regresiona).
   *
   * 'per-hour' = un slot por HORA distinta sobre TODOS los barberos (unión de horas),
   * con el barbero pre-asignado por round-robin (sobre el orden por carga). Da la señal
   * de amplitud HONESTA para la presentación de auto-asign sin barbero (antes el
   * per-barber colapsaba un día completo a 1 slot cuando los barberos compartían la
   * hora más temprana → escondía la tarde). El consumidor elige la hora, no el barbero.
   */
  dedupe?: 'per-barber' | 'per-hour';
};

/**
 * Forma COMPLETA de la disponibilidad de un día (disponibilidad honesta).
 * Separa "qué hay disponible" de "qué se muestra": devuelve el set completo
 * (sin truncar) + su partición por franja, para que presentingSlots decida con
 * el árbol determinista en vez de quedar ciego a 3 slots.
 */
export type DayAvailability = {
  /** Set completo, ya ordenado y deduplicado-por-barbero (auto-assign) o todos (barbero fijo). SIN slice. */
  readonly all: SlotCandidate[];
  readonly total: number;
  /** Franja mañana: hora local < AFTERNOON_CUTOFF. Preserva el orden de `all`. */
  readonly morning: SlotCandidate[];
  /** Franja tarde-noche: hora local >= AFTERNOON_CUTOFF. Preserva el orden de `all`. */
  readonly afternoon: SlotCandidate[];
};

/**
 * Retorna la forma completa de disponibilidad (todos los candidatos, sin truncar).
 *
 * Para auto_assign: aplica round-robin ponderado antes de buscar slots,
 * presentando slots del barbero con menos citas primero (un slot por barbero).
 *
 * Para walk-in: minStart = NOW() + walkInBufferMinutes.
 * `all` contiene como máximo 1 slot (el más cercano).
 *
 * Si el barbero preferido no tiene disponibilidad, `all` es vacío —
 * el state handler decidirá si ofrecer otros barberos.
 *
 * Fuente ÚNICA: cada consumidor toma `.all` (presentación honesta vía decidePresentation)
 * o `.all.slice(0, 3)` cuando arma una lista (cap del pendingSlot, schema index.max(3)).
 */
export async function getDayAvailability(
  opts: GetAvailableSlotsOptions,
): Promise<DayAvailability> {
  const {
    businessId,
    serviceId,
    durationMinutes,
    requestedDate,
    shift,
    preferredStaffId,
    isWalkIn,
    walkInBufferMinutes,
    staffToQuery,
    supabase,
    tz,
    requestedTime,
    dedupe = 'per-barber',
  } = opts;

  // Piso "no agendar en el pasado":
  //   walk-in     → NOW + walkInBufferMinutes (anticipación mínima; sin cambios).
  //   reserva normal → NOW estricto (sin buffer). Antes era null (sin piso), lo que
  //     permitía ofrecer horas ya pasadas del día de hoy. El guard de
  //     generateSlotsForStaff solo aplica el piso cuando isSameDayInTZ(minStart,
  //     requestedDate) → días futuros quedan intactos.
  const minStart = isWalkIn ? addMinutes(new Date(), walkInBufferMinutes) : new Date();
  // dateStr en timezone del negocio (requestedDate es noon UTC de ese día local)
  const dateStr   = utcToLocalDateStr(requestedDate, tz);
  // weekday TZ-independiente: derivado de la fecha LOCAL del negocio, no del TZ
  // del runtime. Antes usaba requestedDate.getDay(), que asumía servidor UTC.
  const dayOfWeek = weekdayFromDateStr(dateStr);  // 0=domingo, 6=sábado

  // Ventana UTC que cubre el día calendario completo en el timezone del negocio
  const dayStartUTC = localTimeToUTC(dateStr, '00:00', tz);
  const dayEndUTC   = localTimeToUTC(dateStr, '23:59', tz);

  // Filtrar staff a considerar
  let candidateStaff: StaffRow[];
  if (preferredStaffId !== null) {
    candidateStaff = staffToQuery.filter((s) => s.id === preferredStaffId);
  } else {
    // Round-robin: ordenar por carga antes de iterar
    const orderedIds = await selectStaffRoundRobin(
      businessId,
      staffToQuery.map((s) => s.id),
      requestedDate,
      dateStr,
      tz,
      supabase,
    );
    candidateStaff = orderedIds
      .map((id) => staffToQuery.find((s) => s.id === id))
      .filter((s): s is StaffRow => s !== undefined);
  }

  if (candidateStaff.length === 0) return bucketShape([], tz);

  // Cargar disponibilidad de todos los candidatos en paralelo
  const staffIds = candidateStaff.map((s) => s.id);

  const [availabilityResult, appointmentsResult, blocksResult, exceptionsResult] = await Promise.all([
    supabase
      .from('staff_availability')
      .select('staff_id, day_of_week, start_time, end_time, break_start, break_end')
      .in('staff_id', staffIds)
      .eq('day_of_week', dayOfWeek)
      .eq('is_active', true),

    tenantDb(supabase, businessId)
      .table('appointments')
      .select('staff_id, starts_at, ends_at')
      .in('staff_id', staffIds)
      .gte('starts_at', dayStartUTC.toISOString())
      .lt('starts_at',  dayEndUTC.toISOString())
      .neq('status', 'cancelled'),

    supabase
      .from('staff_blocks')
      .select('staff_id, starts_at, ends_at')
      .in('staff_id', staffIds)
      .eq('status', 'approved')
      .gte('starts_at', dayStartUTC.toISOString())
      .lt('starts_at',  dayEndUTC.toISOString()),

    tenantDb(supabase, businessId)
      .table('staff_schedule_exceptions')
      .select('staff_id, exception_date, available, start_time, end_time')
      .in('staff_id', staffIds)
      .eq('exception_date', dateStr),
  ]);

  // ── Verificar errores en los queries críticos ────────────────────────────
  // staff_availability y appointments son críticos: sin ellos el cálculo de
  // disponibilidad es incorrecto o puede producir doble booking.
  // staff_blocks es best-effort: si falla, se muestran slots que podrían
  // estar bloqueados pero no se crea doble booking.

  if (availabilityResult.error) {
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'scheduling',
      event:       'staff_availability_query_failed',
      business_id: businessId,
      staff_ids:   staffIds,
      date:        dateStr,
      error:       availabilityResult.error.message,
    }));
    throw new SchedulingQueryError('Error al consultar disponibilidad del staff');
  }

  if (appointmentsResult.error) {
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'scheduling',
      event:       'appointments_query_failed',
      business_id: businessId,
      staff_ids:   staffIds,
      date:        dateStr,
      error:       appointmentsResult.error.message,
    }));
    throw new SchedulingQueryError('Error al consultar citas existentes — riesgo de doble booking');
  }

  if (blocksResult.error) {
    // No crítico — continuar con blocks vacíos. Peor caso: mostrar slots bloqueados.
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'scheduling',
      event:       'staff_blocks_query_failed',
      business_id: businessId,
      staff_ids:   staffIds,
      date:        dateStr,
      error:       blocksResult.error.message,
    }));
  }

  if (exceptionsResult.error) {
    // No crítico — continuar sin excepciones. Peor caso: mostrar slots en días libres.
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'scheduling',
      event:       'staff_schedule_exceptions_query_failed',
      business_id: businessId,
      staff_ids:   staffIds,
      date:        dateStr,
      error:       exceptionsResult.error.message,
    }));
  }

  const availabilityRows = availabilityResult.data as StaffAvailabilityRow[];
  const apptRows         = appointmentsResult.data as Array<{ staff_id: string } & AppointmentBlock>;
  const blockRows        = (blocksResult.data ?? [])        as Array<{ staff_id: string } & StaffBlock>;
  const exceptionRows    = (exceptionsResult.data ?? [])    as ExceptionRow[];

  // Mapa staff_id → excepción para el día solicitado (máximo 1 por staff por fecha — UNIQUE constraint)
  const exceptionMap = new Map<string, ExceptionRow>();
  for (const exc of exceptionRows) {
    exceptionMap.set(exc.staff_id, exc);
  }

  // Verificar si el servicio es compatible con el staff (staff_services)
  const { data: ssData } = await supabase
    .from('staff_services')
    .select('staff_id')
    .in('staff_id', staffIds)
    .eq('service_id', serviceId);

  const staffWithService = new Set(
    ((ssData ?? []) as Array<{ staff_id: string }>).map((r) => r.staff_id),
  );

  const allSlots: SlotCandidate[] = [];

  for (const staff of candidateStaff) {
    if (!staffWithService.has(staff.id)) continue;

    const avail = availabilityRows.find((r) => r.staff_id === staff.id);
    if (!avail) continue;

    const appts  = apptRows.filter((r)  => r.staff_id === staff.id);
    const blocks = blockRows.filter((r) => r.staff_id === staff.id);

    const slots = generateSlotsForStaff(
      staff.id,
      staff.name,
      avail,
      requestedDate,
      dateStr,
      durationMinutes,
      appts,
      blocks,
      minStart,
      shift,
      tz,
      exceptionMap.get(staff.id) ?? null,
    );

    allSlots.push(...slots);

    // Para walk-in solo necesitamos el primer slot disponible
    if (isWalkIn && allSlots.length > 0) break;
  }

  // Walk-in: solo el más cercano
  if (isWalkIn) {
    const earliest = allSlots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    return bucketShape(earliest ? [earliest] : [], tz);
  }

  // Auto-assign: proyección según el knob `dedupe`.
  //   'per-barber' (default): un slot por barbero — opciones diversas (un horario por
  //     cada barbero). "Mejor" = más cercano a requestedTime, o el más temprano.
  //   'per-hour': un slot por HORA distinta sobre TODOS los barberos (unión de horas),
  //     barbero pre-asignado por round-robin → señal de amplitud honesta (no colapsa el
  //     día a 1 slot cuando los barberos comparten la hora más temprana).
  let dedupedSlots: SlotCandidate[];
  if (preferredStaffId === null) {
    if (dedupe === 'per-hour') {
      dedupedSlots = dedupePerHour(allSlots, candidateStaff, tz);
    } else {
      let targetMin: number | null = null;
      if (requestedTime) {
        const [rh, rm] = requestedTime.split(':').map(Number);
        targetMin = (rh ?? 0) * 60 + (rm ?? 0);
      }

      const staffMap = new Map<string, SlotCandidate>();
      for (const slot of allSlots) {
        const existing = staffMap.get(slot.staffId);
        if (!existing) {
          staffMap.set(slot.staffId, slot);
        } else if (targetMin !== null) {
          // Reemplazar si este slot es más cercano al tiempo solicitado
          const slotMin     = utcToLocalMinutes(slot.startsAt, tz);
          const existingMin = utcToLocalMinutes(existing.startsAt, tz);
          if (Math.abs(slotMin - targetMin) < Math.abs(existingMin - targetMin)) {
            staffMap.set(slot.staffId, slot);
          }
        }
        // Sin requestedTime: conservar el primero (más temprano, ya que allSlots es cronológico)
      }
      dedupedSlots = [...staffMap.values()];
    }
  } else {
    dedupedSlots = allSlots;
  }

  // Ordenar: por cercanía a hora solicitada si requestedTime presente,
  // en caso contrario cronológicamente.
  if (requestedTime) {
    const [rh, rm] = requestedTime.split(':').map(Number);
    const targetMin = (rh ?? 0) * 60 + (rm ?? 0);
    dedupedSlots.sort((a, b) => {
      const aMin = utcToLocalMinutes(a.startsAt, tz);
      const bMin = utcToLocalMinutes(b.startsAt, tz);
      const diff = Math.abs(aMin - targetMin) - Math.abs(bMin - targetMin);
      return diff !== 0 ? diff : a.startsAt.getTime() - b.startsAt.getTime();
    });
  } else {
    dedupedSlots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  return bucketShape(dedupedSlots, tz);
}

// Arma la forma completa (all + franjas) sin truncar. El bucketing usa
// AFTERNOON_CUTOFF (14:00). `all` ya viene ordenado; filter preserva el orden.
function bucketShape(slots: SlotCandidate[], tz: string): DayAvailability {
  const morning:   SlotCandidate[] = [];
  const afternoon: SlotCandidate[] = [];
  for (const s of slots) {
    if (utcToLocalMinutes(s.startsAt, tz) < AFTERNOON_CUTOFF) morning.push(s);
    else afternoon.push(s);
  }
  return { all: slots, total: slots.length, morning, afternoon };
}

// Unión de HORAS distintas (disponibilidad honesta para auto-asign sin barbero).
// De allSlots (de todos los barberos candidatos) devuelve UN slot por hora local
// distinta. Cada hora se reparte entre los barberos por round-robin sobre `candidateStaff`
// (ya ordenado por carga): el slot representativo de una hora es el más temprano del
// barbero asignado en esa hora. El caller re-ordena (cercanía a requestedTime o crono)
// y bucketea. Si los barberos comparten horas, ambos terminan presentes (alternancia).
function dedupePerHour(
  allSlots:       SlotCandidate[],
  candidateStaff: StaffRow[],
  tz:             string,
): SlotCandidate[] {
  // hora local (0..23) → (staffId → slot más temprano de ese barbero en esa hora)
  const byHour = new Map<number, Map<string, SlotCandidate>>();
  for (const s of allSlots) {
    const hour = Math.floor(utcToLocalMinutes(s.startsAt, tz) / 60);
    let perStaff = byHour.get(hour);
    if (!perStaff) { perStaff = new Map(); byHour.set(hour, perStaff); }
    const existing = perStaff.get(s.staffId);
    if (!existing || s.startsAt.getTime() < existing.startsAt.getTime()) {
      perStaff.set(s.staffId, s);
    }
  }

  const order = candidateStaff.map((s) => s.id); // orden por carga (round-robin)
  if (order.length === 0) return [];
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  let rr = 0;
  const out: SlotCandidate[] = [];
  for (const hour of hours) {
    const perStaff = byHour.get(hour)!;
    // Round-robin desde `rr`: primer barbero del orden con slot en esta hora.
    let picked: SlotCandidate | undefined;
    for (let k = 0; k < order.length; k++) {
      const slot = perStaff.get(order[(rr + k) % order.length]!);
      if (slot) { picked = slot; rr = (rr + k + 1) % order.length; break; }
    }
    // Salvaguarda (no debería pasar): ningún barbero del orden → cualquiera de la hora.
    out.push(picked ?? [...perStaff.values()][0]!);
  }
  return out;
}

// ─── findSlotsInNextDays ──────────────────────────────────────────────────────
// Busca el primer día (a partir de startAfterDate + 1) que tenga slots
// disponibles, ignorando domingos (day 0).
// Útil cuando la fecha solicitada no tiene disponibilidad y se quieren
// ofrecer alternativas concretas sin preguntar al usuario.

export type FindSlotsBaseOptions = Omit<
  GetAvailableSlotsOptions,
  'requestedDate' | 'shift' | 'isWalkIn' | 'preferredStaffId'
>;
// Nota: tz está incluido en FindSlotsBaseOptions vía GetAvailableSlotsOptions.

/**
 * Retorna el primer día con slots disponibles dentro de los próximos
 * `maxCalendarDays` días calendario (saltando domingos).
 * Siempre busca con shift=null y autoAssign (preferredStaffId=null).
 * Retorna null si no encuentra disponibilidad en el rango.
 */
export async function findSlotsInNextDays(
  startAfterDate:  Date,
  maxCalendarDays: number,
  baseOpts:        FindSlotsBaseOptions,
): Promise<{ date: Date; slots: SlotCandidate[] } | null> {
  for (let i = 1; i <= maxCalendarDays; i++) {
    const candidate = new Date(startAfterDate);
    candidate.setDate(candidate.getDate() + i);
    // TODO(BAJO-4): Domingo hardcodeado — asume que todas las barberías cierran domingo.
    // Fix: agregar campo `closedDays?: number[]` a FindSlotsBaseOptions y pasarlo desde
    // el caller (presentingSlots.ts vía business.officeHours). Si officeHours es null
    // (24h) o el día tiene horario, no omitir. Mientras tanto, si un barbero tiene
    // staff_availability para domingo, getDayAvailability lo encontrará aunque lo saltemos
    // aquí (perdemos esa fecha en la búsqueda de alternativas, no en citas directas).
    if (candidate.getDay() === 0) continue; // domingo — hardcoded como cerrado

    // Inline del ex-wrapper getAvailableSlots: forma completa topada al cap del pendingSlot
    // (≤3). dedupe default 'per-barber' (un slot por barbero) — comportamiento de siempre.
    const slots = (await getDayAvailability({
      ...baseOpts,
      requestedDate:    candidate,
      shift:            null,
      isWalkIn:         false,
      preferredStaffId: null,
    })).all.slice(0, 3);

    if (slots.length > 0) return { date: candidate, slots };
  }
  return null;
}
