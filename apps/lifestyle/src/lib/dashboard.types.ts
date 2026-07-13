// ─── Dashboard Types & Queries ────────────────────────────────────────────────
// Tipos TypeScript para todos los datos del dashboard admin y la vista staff.
// Queries tipadas para: citas del día, disponibilidad de staff, ingresos,
// métricas por período, y datos exclusivos de la vista del barbero.
//
// IMPORTANTE: Las funciones de query solo se llaman desde Server Components
// y Route Handlers — usan service_role_key y nunca salen al cliente.

// ─── Tipos del mini-sitio público ─────────────────────────────────────────────
// Usados exclusivamente en apps/lifestyle/src/app/[slug]/page.tsx y sus
// componentes hijo. Separados de los tipos del dashboard para evitar acoplamiento.

export type SitePalette = 'obsidian' | 'humo' | 'cuero' | 'bronce' | 'blanco' | 'arena';

export type OfficeHours = Record<string, { open: string; close: string }>;

export type SiteBusinessRow = {
  id: string;
  name: string;
  slug: string;
  whatsapp_number: string;
  logo_url: string | null;
  cover_image_url: string | null;
  description: string | null;
  address: string;
  // Campos de diseño (migration 022)
  palette: SitePalette;
  tagline: string | null;
  office_hours: OfficeHours;
  instagram_url: string | null;
  tiktok_url: string | null;
  whatsapp_message: string | null;
};

export type SiteServiceRow = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  currency: string;
};

export type SiteStaffRow = {
  id: string;
  name: string;
  role: string;    // 'barber' | 'assistant' | 'admin'
  active: boolean;
  photo_url: string | null;
};

// ─── Tipo para el gestor de fotos del dashboard admin ─────────────────────────
// Separado de DashboardStaff (que incluye disponibilidad) para evitar
// contaminar ese tipo con datos de foto.

export type AdminStaffPhotoRow = {
  id: string;
  name: string;
  photo_url: string | null;
};

import { createClient } from '@supabase/supabase-js';
import type {
  AppointmentStatus,
  AppointmentSource,
  StaffRole,
} from '@presenciapro/engine/types';

// ─── Service client ───────────────────────────────────────────────────────────
// Misma función que en [slug]/page.tsx — bypasa RLS con service_role_key.

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, key);
}

// ─── Tipos de referencia (shapes de joins en selects) ─────────────────────────

export type StaffRef = {
  id: string;
  name: string;
};

export type ServiceRef = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  currency: string;
};

export type CustomerRef = {
  id: string;
  name: string;
  phone: string | null;
};

// ─── Cita con joins ───────────────────────────────────────────────────────────

export type DashboardAppointment = {
  id: string;
  starts_at: string;        // ISO 8601 UTC
  ends_at: string;          // ISO 8601 UTC
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string | null;
  staff: StaffRef;
  service: ServiceRef;
  customer: CustomerRef | null;  // null en walk-ins sin cliente registrado
  created_by: StaffRef | null;   // quien creó la cita (Feature 5)
  modified_by: StaffRef | null;  // quien hizo la última modificación (Feature 5)
  modified_at: string | null;    // timestamp de la última modificación (Feature 5)
  allow_overlap: boolean;        // TRUE = solape intencional aprobado por la recepción (S6-UI-02 PR-3)
  adjusted_starts_at: string | null;   // nueva hora acordada si el cliente reportó retraso (S6-UI-02 PR-5)
  late_arrival_acknowledged: boolean;  // TRUE si el bot ya procesó un retraso reportado (S6-UI-02 PR-5)
  price_charged: number | null;        // precio SELLADO al completar (migración 049); null si aún no se completó
  arrived_at: string | null;           // timestamp de llegada del cliente (botón "Llegó", Paso 3B); null = no marcado
};

// ─── Staff con disponibilidad ─────────────────────────────────────────────────

export type StaffAvailabilitySlot = {
  day_of_week:  number;           // 0=domingo … 6=sábado
  start_time:   string;           // 'HH:MM:SS'
  end_time:     string;           // 'HH:MM:SS'
  break_start?: string | null;    // 'HH:MM:SS' o null
  break_end?:   string | null;    // 'HH:MM:SS' o null
  is_active?:   boolean;          // default true
};

export type DashboardStaff = {
  id: string;
  name: string;
  role: StaffRole;
  availabilityToday: StaffAvailabilitySlot | null;  // null = sin horario hoy
};

// ─── Ingresos del día ─────────────────────────────────────────────────────────

export type DayRevenue = {
  total: number;
  currency: string;
  completedCount: number;
};

// ─── Métricas por barbero ─────────────────────────────────────────────────────

export type StaffMetricsPeriod = 'week' | 'month';

export type StaffMetrics = {
  staff_id: string;
  staff_name: string;
  photo_url: string | null;
  appointments_completed: number;
  appointments_no_show: number;
  appointments_cancelled: number;
  total_revenue: number;
  recurring_clients: number;   // clientes que vinieron 2+ veces al negocio
  new_clients: number;         // clientes con exactamente 1 visita al negocio
  period: StaffMetricsPeriod;
};

// ─── Perfil contextual del cliente (vista staff) ──────────────────────────────

export type UpcomingAppointmentRef = {
  service_name: string;
  starts_at: string;
  ends_at: string;
};

export type ClientProfile = {
  customer_id: string;
  name: string;
  phone: string;
  visit_count: number;
  last_visit: string | null;
  favorite_service: string | null;   // nombre del servicio
  favorite_staff: string | null;     // nombre del barbero
  notes: string | null;
  upcoming_appointment: UpcomingAppointmentRef;
};

// ─── Métricas por período ─────────────────────────────────────────────────────

export type MetricsPeriod = 'day' | 'week' | 'month';

export type SourceBreakdownMetrics = {
  bot: number;
  walkin: number;
  llamada: number;
  manual: number;
};

export type NoShowByDayEntry = {
  no_show: number;
  completed: number;
};

export type PeriodMetrics = {
  period: MetricsPeriod;
  date: string;         // YYYY-MM-DD (día ancla del período)
  revenue: number;
  currency: string;
  total: number;
  completed: number;
  cancelled: number;
  no_show: number;
  pending: number;
  confirmed: number;
  walkin: number;
  // ── Nuevos campos Bloque B ──────────────────────────────────────────
  hourly: Record<number, number>;     // hora (0-23) → nº de citas
  source: SourceBreakdownMetrics;     // desglose por canal de origen
  recurring_clients: number;          // clientes con 2+ citas en el período
  new_clients: number;                // clientes con exactamente 1 cita en el período
  // ── Analítica extendida ─────────────────────────────────────────────
  noshow_by_day: Record<number, NoShowByDayEntry>; // JS getDay() (0=dom…6=sáb) → {no_show, completed}
  top_clients: TopClientEntry[];      // top 5 clientes por visitas en el período
};

export type TopClientEntry = {
  customer_id: string;
  name: string;
  visit_count: number;
};

// ─── Shape interno del select de appointments con joins ───────────────────────
// Representa lo que Supabase JS retorna para el select anidado.
// El FK staff_id y service_id son NOT NULL → objeto (no array).
// customer_id, created_by_staff_id, modified_by_staff_id son nullable → objeto | null.

type RawAppointmentRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  notes: string | null;
  staff: StaffRef;
  service: ServiceRef;
  customer: CustomerRef | null;
  created_by: StaffRef | null;
  modified_by: StaffRef | null;
  modified_at: string | null;
  adjusted_starts_at: string | null;
  late_arrival_acknowledged: boolean;
  price_charged: number | null;
};

// Shape interno del select de staff con availability (one-to-many → array)
type RawStaffRow = {
  id: string;
  name: string;
  role: string;
  availability: StaffAvailabilitySlot[];
};

// Shape interno del select de métricas
type RawMetricsRow = {
  status: string;
  source: string;
  starts_at: string;
  price_charged: number | null;
  customer_id: string | null;
  service: { price: number; currency: string } | null;
};

// ─── Query: citas del día ─────────────────────────────────────────────────────

/**
 * Instante UTC que corresponde a una hora-de-pared (naive) en una tz IANA.
 * Usa el offset real de la tz en ese instante (México es UTC-6 fijo; maneja DST
 * donde aplique, salvo el borde exacto de una transición a medianoche — irrelevante
 * para límites de día en producción).
 *
 * Exportado (S6-DATA-01): `rescheduleAppointment` lo usa para interpretar la
 * hora-de-pared que recibe como hora del NEGOCIO (no del servidor Vercel=UTC).
 */
export function zonedWallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const asIfUtc = new Date(`${dateStr}T${timeStr}Z`).getTime();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(asIfUtc));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const localAsUtc = Date.UTC(
    Number(m['year']),
    Number(m['month']) - 1,
    Number(m['day']),
    Number(m['hour'] === '24' ? '0' : m['hour']),
    Number(m['minute']),
    Number(m['second']),
  );
  return new Date(asIfUtc - (localAsUtc - asIfUtc));
}

/**
 * Rango `[inicio, fin)` del día `date` en la tz del negocio, como instantes UTC ISO.
 * El día local va de 00:00 a 00:00 del día siguiente. Exportado para que otras
 * queries del día (bloqueos, etc.) usen los mismos límites tz-correctos.
 */
export function localDayRangeUtc(date: string, timeZone: string): { start: string; end: string } {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextStr = next.toISOString().slice(0, 10);
  return {
    start: zonedWallTimeToUtc(date, '00:00:00', timeZone).toISOString(),
    end: zonedWallTimeToUtc(nextStr, '00:00:00', timeZone).toISOString(),
  };
}

/**
 * Retorna las citas de un día dado con staff, servicio y cliente.
 * El día se acota a la **tz del negocio** (`businesses.timezone`), no a UTC: sin
 * esto, un negocio UTC-6 perdía las citas ≥18:00 locales (caían al día UTC siguiente).
 * @param businessId - UUID del negocio (del staff autenticado — nunca del cliente)
 * @param date - 'YYYY-MM-DD' en la tz del negocio
 */
export async function getDayAppointments(
  businessId: string,
  date: string,
  // Opcional: tz del negocio ya cargada por el caller. Si se pasa, se evita el
  // round-trip interno a `businesses`. Retrocompatible: sin él, se consulta.
  timezone?: string,
): Promise<DashboardAppointment[]> {
  const supabase = getServiceClient();

  // Límites del día en la tz del negocio → instantes UTC para filtrar timestamptz.
  let timeZone = timezone;
  if (timeZone === undefined) {
    const { data: bizRow } = await supabase
      .from('businesses')
      .select('timezone')
      .eq('id', businessId)
      .maybeSingle();
    timeZone = (bizRow as { timezone: string | null } | null)?.timezone ?? 'America/Mexico_City';
  }
  const { start, end } = localDayRangeUtc(date, timeZone);

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      starts_at,
      ends_at,
      status,
      source,
      notes,
      modified_at,
      allow_overlap,
      adjusted_starts_at,
      late_arrival_acknowledged,
      price_charged,
      arrived_at,
      staff:staff_id(id, name),
      service:service_id(id, name, duration_minutes, price, currency),
      customer:customer_id(id, name, phone),
      created_by:created_by_staff_id(id, name),
      modified_by:modified_by_staff_id(id, name)
    `)
    .eq('business_id', businessId)
    .gte('starts_at', start)
    .lt('starts_at', end)
    .order('starts_at');

  if (error) throw new Error(`getDayAppointments failed: ${error.message}`);

  return (data ?? []) as unknown as RawAppointmentRow[] as DashboardAppointment[];
}

// ─── Query: staff activo con disponibilidad ───────────────────────────────────

/**
 * Retorna el staff activo del negocio con su disponibilidad para el día dado.
 * @param businessId - UUID del negocio
 * @param dayOfWeek - JS Date.getDay() del día consultado (0=dom … 6=sáb)
 */
export async function getActiveStaffWithAvailability(
  businessId: string,
  dayOfWeek: number,
): Promise<DashboardStaff[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('staff')
    .select(`
      id,
      name,
      role,
      availability:staff_availability(day_of_week, start_time, end_time, break_start, break_end, is_active)
    `)
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');

  if (error) throw new Error(`getActiveStaffWithAvailability failed: ${error.message}`);

  const rows = (data ?? []) as unknown as RawStaffRow[];

  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role as StaffRole,
    // Solo días activos cuentan como "trabaja hoy" (is_active default true).
    availabilityToday:
      s.availability.find((a) => a.day_of_week === dayOfWeek && a.is_active !== false) ?? null,
  }));
}

// ─── Query: excepciones de horario del día (día libre / horario especial) ──────

export type DayException = {
  staff_id: string;
  available: boolean;              // false = día libre
  start_time: string | null;      // 'HH:MM:SS' — horario especial si available
  end_time: string | null;
};

/**
 * Excepciones de fecha específica (staff_schedule_exceptions) para un día del negocio.
 * Consumido por la mesa de control para acotar la disponibilidad del panorama.
 */
/** businesses.require_customer_phone — si el negocio exige teléfono al agendar (walk-in). */
export async function getRequireCustomerPhone(businessId: string): Promise<boolean> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('businesses')
    .select('require_customer_phone')
    .eq('id', businessId)
    .maybeSingle();
  return (data as { require_customer_phone: boolean } | null)?.require_customer_phone ?? false;
}

/**
 * businesses.max_late_minutes — tolerancia de retraso del negocio (default 15).
 * Piso de la señal "atrasado" de la cola de acción: una cita solo escala a la cola
 * cuando su hora efectiva pasó por MÁS de estos minutos (S6-UI-02 PR-5).
 */
export async function getMaxLateMinutes(businessId: string): Promise<number> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('businesses')
    .select('max_late_minutes')
    .eq('id', businessId)
    .maybeSingle();
  return (data as { max_late_minutes: number | null } | null)?.max_late_minutes ?? 15;
}

/**
 * Config del negocio para la mesa de control, en UN solo round-trip a `businesses`.
 * Fusiona lo que antes eran 4 lecturas separadas al MISMO row (getBusinessName +
 * getBusinessTimezone + getRequireCustomerPhone + getMaxLateMinutes). Mismos
 * fallbacks que esas 4 funciones — no cambia ningún valor observable.
 */
export type BusinessDeskConfig = {
  name: string;
  timezone: string;
  requireCustomerPhone: boolean;
  maxLateMinutes: number;
};

export async function getBusinessDeskConfig(businessId: string): Promise<BusinessDeskConfig> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('businesses')
    .select('name, timezone, require_customer_phone, max_late_minutes')
    .eq('id', businessId)
    .maybeSingle();
  const row = data as {
    name: string | null;
    timezone: string | null;
    require_customer_phone: boolean | null;
    max_late_minutes: number | null;
  } | null;
  return {
    name:                 row?.name ?? '',
    timezone:             row?.timezone ?? 'America/Mexico_City',
    requireCustomerPhone: row?.require_customer_phone ?? false,
    maxLateMinutes:       row?.max_late_minutes ?? 15,
  };
}

export async function getDayExceptions(
  businessId: string,
  date: string,
): Promise<DayException[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('staff_schedule_exceptions')
    .select('staff_id, available, start_time, end_time')
    .eq('business_id', businessId)
    .eq('exception_date', date);
  if (error) throw new Error(`getDayExceptions failed: ${error.message}`);
  return (data ?? []) as DayException[];
}

// ─── Query: bloqueos aprobados del día (core reutilizable) ─────────────────────

export type StaffBlockForDay = {
  staffId: string;
  startsAt: string;  // ISO 8601 UTC
  endsAt: string;    // ISO 8601 UTC
};

/**
 * Core puro de bloqueos aprobados que se solapan con el día, dado el set de
 * staff IDs y la tz del negocio YA resueltos por el caller. Sirve a dos rutas:
 *  - la mesa de control (dashboard/page) que ya cargó staff + tz → los reusa
 *    (evita re-consultar `staff` y `businesses`).
 *  - la server action `getStaffBlocksForDay` (assistant-actions), que deriva
 *    staffIds/tz de la sesión y delega aquí.
 * NO es una server action (no client-callable): los staffIds llegan solo desde
 * código server que ya los scopeó por negocio → sin superficie cross-tenant.
 */
export async function queryStaffBlocksForDay(
  staffIds: string[],
  timezone: string,
  date: string,
): Promise<StaffBlockForDay[]> {
  if (staffIds.length === 0) return [];
  const supabase = getServiceClient();
  // Límites en la TZ del negocio (no UTC), si no se perdían bloqueos de la
  // tarde/noche (≥18:00 en UTC-6).
  const { start: dayStart, end: dayEnd } = localDayRangeUtc(date, timezone);

  const { data, error } = await supabase
    .from('staff_blocks')
    .select('staff_id, starts_at, ends_at')
    .in('staff_id', staffIds)
    .eq('status', 'approved')
    .lt('starts_at', dayEnd)
    .gt('ends_at', dayStart);

  if (error || !data) return [];

  return (data as { staff_id: string; starts_at: string; ends_at: string }[]).map((b) => ({
    staffId: b.staff_id,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
  }));
}

// ─── Función pura: ingresos del día ──────────────────────────────────────────
// No hace fetch — opera sobre los appointments ya cargados.
// Separado de getDayAppointments para reusar los datos ya traídos del servidor.

export function computeDayRevenue(appointments: DashboardAppointment[]): DayRevenue {
  const completed = appointments.filter((a) => a.status === 'completed');
  // Precio SELLADO al completar (049) — editar el precio del servicio NO reescribe la
  // historia. Fallback al precio vivo solo para completadas legacy sin sello.
  const total = completed.reduce((sum, a) => sum + (a.price_charged ?? a.service.price), 0);
  const currency = completed[0]?.service.currency ?? 'MXN';
  return { total, currency, completedCount: completed.length };
}

// ─── Query: métricas por período ─────────────────────────────────────────────

/**
 * Agrega métricas (revenue + conteos por status) para day/week/month.
 * @param businessId - UUID del negocio
 * @param period - 'day' | 'week' | 'month'
 * @param date - 'YYYY-MM-DD' día ancla del período
 */
export async function getPeriodMetrics(
  businessId: string,
  period: MetricsPeriod,
  date: string,
): Promise<PeriodMetrics> {
  const supabase = getServiceClient();
  const { start, end } = getPeriodRange(period, date);

  const { data, error } = await supabase
    .from('appointments')
    .select('status, source, starts_at, customer_id, price_charged, service:service_id(price, currency)')
    .eq('business_id', businessId)
    .gte('starts_at', start)
    .lte('starts_at', end);

  if (error) throw new Error(`getPeriodMetrics failed: ${error.message}`);

  const rows = (data ?? []) as unknown as RawMetricsRow[];

  let revenue = 0;
  let currency = 'MXN';
  let completed = 0;
  let cancelled = 0;
  let no_show = 0;
  let pending = 0;
  let confirmed = 0;
  let walkin = 0;

  const hourly: Record<number, number> = {};
  const source: SourceBreakdownMetrics = { bot: 0, walkin: 0, llamada: 0, manual: 0 };
  const customerCounts = new Map<string, number>();
  const noshowByDay: Record<number, NoShowByDayEntry> = {};

  for (const row of rows) {
    // Status buckets
    switch (row.status) {
      case 'completed':
        completed++;
        if (row.service) {
          // Precio SELLADO al completar (049); fallback al vivo solo si falta el sello.
          revenue += row.price_charged ?? row.service.price;
          currency = row.service.currency;
        }
        break;
      case 'cancelled':  cancelled++; break;
      case 'no_show':    no_show++;   break;
      case 'pending':    pending++;   break;
      case 'confirmed':  confirmed++; break;
      case 'walkin':     walkin++;    break;
    }

    // Hourly distribution (UTC hour from starts_at ISO string)
    const hour = new Date(row.starts_at).getUTCHours();
    hourly[hour] = (hourly[hour] ?? 0) + 1;

    // Source breakdown
    const src = row.source as keyof SourceBreakdownMetrics;
    if (src in source) source[src]++;

    // Recurring vs new clients
    if (row.customer_id) {
      customerCounts.set(row.customer_id, (customerCounts.get(row.customer_id) ?? 0) + 1);
    }

    // No-show por día de semana (completed + no_show — los que tienen peso en la tasa)
    if (row.status === 'completed' || row.status === 'no_show') {
      const dayOfWeek = new Date(row.starts_at).getDay(); // 0=dom…6=sáb
      const entry = noshowByDay[dayOfWeek] ?? { no_show: 0, completed: 0 };
      if (row.status === 'no_show') entry.no_show++;
      else entry.completed++;
      noshowByDay[dayOfWeek] = entry;
    }
  }

  let recurring_clients = 0;
  let new_clients = 0;
  for (const count of customerCounts.values()) {
    if (count >= 2) recurring_clients++;
    else new_clients++;
  }

  // Top 5 clientes por visitas en el período
  const topCustomerIds = [...customerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  let top_clients: TopClientEntry[] = [];
  if (topCustomerIds.length > 0) {
    const { data: custData } = await supabase
      .from('customers')
      .select('id, name')
      .in('id', topCustomerIds);

    if (custData) {
      const nameMap = new Map((custData as { id: string; name: string }[]).map((c) => [c.id, c.name]));
      top_clients = topCustomerIds.map((id) => ({
        customer_id: id,
        name: nameMap.get(id) ?? 'Cliente',
        visit_count: customerCounts.get(id) ?? 0,
      }));
    }
  }

  return {
    period,
    date,
    revenue,
    currency,
    total: rows.length,
    completed,
    cancelled,
    no_show,
    pending,
    confirmed,
    walkin,
    hourly,
    source,
    recurring_clients,
    new_clients,
    noshow_by_day: noshowByDay,
    top_clients,
  };
}

// ─── Helper: rango de fechas por período ─────────────────────────────────────

export function getPeriodRange(
  period: MetricsPeriod,
  date: string,
): { start: string; end: string } {
  const d = new Date(`${date}T12:00:00`);  // mediodía para evitar DST edge cases

  if (period === 'day') {
    return {
      start: `${date}T00:00:00`,
      end: `${date}T23:59:59`,
    };
  }

  if (period === 'week') {
    // Semana: lunes → domingo
    const day = d.getDay();                        // 0=domingo
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: `${toDateStr(monday)}T00:00:00`,
      end: `${toDateStr(sunday)}T23:59:59`,
    };
  }

  // month
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    start: `${toDateStr(firstDay)}T00:00:00`,
    end: `${toDateStr(lastDay)}T23:59:59`,
  };
}

// ─── Helper: Date → 'YYYY-MM-DD' ─────────────────────────────────────────────

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISTA STAFF — tipos y queries exclusivos de la vista del barbero
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Tipos de la vista staff ──────────────────────────────────────────────────

/**
 * Cita vista desde la perspectiva del barbero.
 * Omite el campo `staff` (es él mismo) para evitar redundancia.
 */
export type DayAppointmentForStaff = {
  id: string;
  starts_at: string;        // ISO 8601 UTC
  ends_at: string;          // ISO 8601 UTC
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string | null;
  service: ServiceRef;
  customer: CustomerRef | null;  // null en walk-ins sin cliente registrado
};

/**
 * Solicitud de bloqueo puntual del barbero con su estado de aprobación.
 * Refleja una fila de staff_blocks con las columnas status (migration 003)
 * y urgent (migration 008).
 */
export type StaffBlockRequest = {
  id: string;
  starts_at: string;        // ISO 8601 UTC
  ends_at: string;          // ISO 8601 UTC
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  urgent: boolean;
  created_at: string;       // ISO 8601 UTC
};

/**
 * Solicitud de bloqueo con nombre del barbero — para la bandeja del admin.
 * Join de staff_blocks + staff.name via staff_id.
 */
export type BlockRequestWithStaff = StaffBlockRequest & {
  staff_name: string;
};

// ─── Shapes internos para queries staff ──────────────────────────────────────

type RawStaffAppointmentRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  notes: string | null;
  service: ServiceRef;
  customer: CustomerRef | null;
};

type RawStaffAvailabilityRow = {
  id:          string;
  day_of_week: number;
  start_time:  string;
  end_time:    string;
  break_start: string | null;
  break_end:   string | null;
  is_active:   boolean;
};

type RawStaffBlockRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  status: string;
  urgent: boolean;
  created_at: string;
};

type RawBlockWithStaffRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  status: string;
  urgent: boolean;
  created_at: string;
  staff: { name: string } | null;
};

// ─── Query: citas del barbero para un día ────────────────────────────────────

/**
 * Retorna las citas del día para un barbero específico, con servicio y cliente.
 * @param staffId - UUID del staff autenticado (del servidor — nunca del cliente)
 * @param date    - 'YYYY-MM-DD'
 */
export async function getStaffDayAppointments(
  staffId: string,
  date: string,
): Promise<DayAppointmentForStaff[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      starts_at,
      ends_at,
      status,
      source,
      notes,
      service:service_id(id, name, duration_minutes, price, currency),
      customer:customer_id(id, name, phone)
    `)
    .eq('staff_id', staffId)
    .gte('starts_at', `${date}T00:00:00`)
    .lte('starts_at', `${date}T23:59:59`)
    .order('starts_at');

  if (error) throw new Error(`getStaffDayAppointments failed: ${error.message}`);

  return (data ?? []) as unknown as RawStaffAppointmentRow[] as DayAppointmentForStaff[];
}

// ─── Query: disponibilidad recurrente del barbero ────────────────────────────

/**
 * Retorna los slots de disponibilidad semanal configurados para el barbero.
 * Ordenados por día de semana (0=domingo … 6=sábado).
 */
export async function getStaffRecurringAvailability(
  staffId: string,
): Promise<StaffAvailabilitySlot[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('staff_availability')
    .select('id, day_of_week, start_time, end_time, break_start, break_end, is_active')
    .eq('staff_id', staffId)
    .order('day_of_week');

  if (error) throw new Error(`getStaffRecurringAvailability failed: ${error.message}`);

  return (data ?? []) as unknown as RawStaffAvailabilityRow[] as StaffAvailabilitySlot[];
}

// ─── Query: solicitudes de bloqueo del barbero (últimos 30 días) ─────────────

/**
 * Retorna las solicitudes de bloqueo recientes del barbero, más reciente primero.
 * Ventana: desde 30 días antes de hoy hasta el futuro.
 */
export async function getStaffBlockRequests(
  staffId: string,
): Promise<StaffBlockRequest[]> {
  const supabase = getServiceClient();

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString();

  const { data, error } = await supabase
    .from('staff_blocks')
    .select('id, starts_at, ends_at, reason, status, urgent, created_at')
    .eq('staff_id', staffId)
    .gte('created_at', sinceStr)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getStaffBlockRequests failed: ${error.message}`);

  return (data ?? []) as unknown as RawStaffBlockRow[] as StaffBlockRequest[];
}

// ─── Query: solicitudes pendientes del negocio (para el admin) ───────────────

/**
 * Retorna todas las solicitudes con status='pending' del negocio, con nombre
 * del barbero. Urgentes primero, luego por starts_at ascendente.
 * Solo se llama desde Server Components con service_role_key.
 *
 * Estrategia: primero obtiene los staff_ids del negocio, luego filtra
 * staff_blocks por esos IDs. Dos queries livianas — N de barberos es pequeño.
 */
export async function getPendingBlockRequests(
  businessId: string,
): Promise<BlockRequestWithStaff[]> {
  const supabase = getServiceClient();

  // 1. Staff activo del negocio
  const { data: staffData, error: staffError } = await supabase
    .from('staff')
    .select('id')
    .eq('business_id', businessId)
    .eq('active', true);

  if (staffError) throw new Error(`getPendingBlockRequests(staff) failed: ${staffError.message}`);

  const staffIds = ((staffData ?? []) as { id: string }[]).map((s) => s.id);
  if (staffIds.length === 0) return [];

  // 2. Solicitudes pendientes de esos staff, con nombre del barbero
  const { data, error } = await supabase
    .from('staff_blocks')
    .select(`
      id,
      staff_id,
      starts_at,
      ends_at,
      reason,
      status,
      urgent,
      created_at,
      staff:staff_id(name)
    `)
    .eq('status', 'pending')
    .in('staff_id', staffIds)
    .order('urgent', { ascending: false })
    .order('starts_at', { ascending: true });

  if (error) throw new Error(`getPendingBlockRequests failed: ${error.message}`);

  const rows = (data ?? []) as unknown as (RawBlockWithStaffRow & { staff_id: string })[];

  return rows.map((r) => ({
    id: r.id,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    reason: r.reason,
    status: r.status as StaffBlockRequest['status'],
    urgent: r.urgent,
    created_at: r.created_at,
    staff_name: r.staff?.name ?? '',
  }));
}

// ─── Reporte semanal ──────────────────────────────────────────────────────────

export type WeeklyReportData = {
  period_start: string;                  // 'YYYY-MM-DD' — lunes de la semana
  period_end: string;                    // 'YYYY-MM-DD' — domingo de la semana
  total_revenue: number;
  appointments_completed: number;
  appointments_no_show: number;
  top_staff_name: string | null;
  top_staff_revenue: number | null;
  new_clients: number;
  recurring_clients: number;
};

// ─── Clientes inactivos ───────────────────────────────────────────────────────

export type InactiveClientTier = 'por_vencer' | 'inactivo' | 'en_riesgo';

export type InactiveClient = {
  customer_id: string;
  name: string;
  phone: string;
  days_inactive: number;
  last_service: string | null;           // nombre del servicio
  last_staff: string | null;             // nombre del barbero
  visit_count: number;
  tier: InactiveClientTier;
};

// ─── Waitlist ─────────────────────────────────────────────────────────────────

export type WaitlistEntry = {
  id: string;
  business_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  service_id: string;
  service_name: string;
  staff_id: string | null;
  staff_name: string | null;
  requested_date: string;
  requested_time_preference: string | null;
  status: 'waiting' | 'notified' | 'confirmed' | 'expired';
  notified_at: string | null;
  expires_at: string | null;
  created_at: string;
};

// ─── Staff para panel de gestión (todos — incluyendo inactivos) ───────────────

export type AdminStaffManagementRow = {
  id: string;
  name: string;
  role: string;
  photo_url: string | null;
  active: boolean;
  pin: string | null;
};

/**
 * Retorna TODOS los miembros del staff del negocio (activos e inactivos)
 * con los campos necesarios para el panel de gestión.
 */
export async function getAllStaffForManagement(
  businessId: string,
): Promise<AdminStaffManagementRow[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('staff')
    .select('id, name, role, photo_url, active, pin')
    .eq('business_id', businessId)
    .order('name');

  if (error) throw new Error(`getAllStaffForManagement failed: ${error.message}`);

  return (data ?? []) as AdminStaffManagementRow[];
}

// ─── Query: staff activo con photo_url (para el gestor de fotos) ──────────────

/**
 * Retorna el staff activo del negocio con su photo_url.
 * Usado exclusivamente desde Server Components del dashboard admin.
 * @param businessId - UUID del negocio (del staff autenticado — nunca del cliente)
 */
export async function getActiveStaffWithPhoto(
  businessId: string,
): Promise<AdminStaffPhotoRow[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('staff')
    .select('id, name, photo_url')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');

  if (error) throw new Error(`getActiveStaffWithPhoto failed: ${error.message}`);

  return (data ?? []) as AdminStaffPhotoRow[];
}

