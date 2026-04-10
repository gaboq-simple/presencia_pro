// ─── Dashboard Queries ─────────────────────────────────────────────────────────
// Server-side data fetching for the dashboard module.
// All functions are pure async — no React dependencies, no env var reads.
// Infrastructure (supabase, serviceNameMap) is injected by the API route caller.
//
// Rule: every query includes client_id in WHERE — data never crosses clients.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PatientHistory,
  PatientHistorySummary,
  PatientHistoryAppointment,
  IntakeData,
  IntakeField,
  MonthlyMetrics,
  ServiceCount,
  AnalyticsMetrics,
  AtRiskPatient,
} from './types';
import type { AppointmentStatus } from '../scheduling/types';

// ─── Internal row types ────────────────────────────────────────────────────────

type PatientRow = {
  id: string;
  name: string;
  phone: string;
};

type AppointmentRow = {
  id: string;
  service_id: string;
  starts_at: string;
  status: string;
  intake_id: string | null;
};

type IntakeRow = {
  id: string;
  appointment_id: string;
  fields: Record<string, unknown>;
  signed_at: string | null;
};

// ─── getPatientHistory ─────────────────────────────────────────────────────────

/**
 * Returns the full history for a single patient: summary stats + all appointments
 * with their intake data pre-loaded.
 *
 * Performs 3 queries:
 *  1. Fetch patient row
 *  2. Fetch all appointments for the patient (newest first)
 *  3. Batch-fetch intakes for appointments that have an intake_id
 *
 * @param serviceNameMap - serviceId → display name, built from clientConfig.services
 *                         by the API route. The engine never imports client.config.
 */
export async function getPatientHistory(params: {
  readonly clientId: string;
  readonly patientId: string;
  readonly serviceNameMap: ReadonlyMap<string, string>;
  readonly supabase: SupabaseClient;
}): Promise<PatientHistory> {
  const { clientId, patientId, serviceNameMap, supabase } = params;

  // ── 1. Patient ───────────────────────────────────────────────────────────────
  const { data: patientData, error: patientError } = await supabase
    .from('patients')
    .select('id, name, phone')
    .eq('client_id', clientId)
    .eq('id', patientId)
    .single();

  if (patientError || !patientData) {
    throw new Error(`Patient not found: ${patientId}`);
  }

  const patientRow = patientData as PatientRow;

  // ── 2. Appointments ──────────────────────────────────────────────────────────
  const { data: apptData, error: apptError } = await supabase
    .from('appointments')
    .select('id, service_id, starts_at, status, intake_id')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .neq('status', 'emergency_blocked')
    .order('starts_at', { ascending: false });

  if (apptError) {
    throw new Error(`Failed to fetch appointments: ${apptError.message}`);
  }

  const apptRows = (apptData ?? []) as AppointmentRow[];

  // ── 3. Intakes (batch) ───────────────────────────────────────────────────────
  const intakeIds = apptRows
    .map((a) => a.intake_id)
    .filter((id): id is string => id !== null);

  const intakeMap = new Map<string, IntakeData>();

  if (intakeIds.length > 0) {
    const { data: intakeData, error: intakeError } = await supabase
      .from('intakes')
      .select('id, appointment_id, fields, signed_at')
      .eq('client_id', clientId)
      .in('id', intakeIds);

    if (intakeError) {
      throw new Error(`Failed to fetch intakes: ${intakeError.message}`);
    }

    for (const row of (intakeData ?? []) as IntakeRow[]) {
      const fields: IntakeField[] = Object.entries(row.fields).map(([key, value]) => ({
        key,
        label: key,        // API route may override with INTAKE_FIELD_LABELS if needed
        value: String(value ?? ''),
      }));

      intakeMap.set(row.appointment_id, {
        id:       row.id,
        fields,
        signedAt: row.signed_at ? new Date(row.signed_at) : null,
      });
    }
  }

  // ── Build patient summary ────────────────────────────────────────────────────
  const completedAppts = apptRows.filter((a) => a.status === 'completed');

  const startsAts = completedAppts.map((a) => new Date(a.starts_at).getTime());

  const summary: PatientHistorySummary = {
    id:          patientRow.id,
    name:        patientRow.name,
    phone:       patientRow.phone,
    totalVisits: completedAppts.length,
    firstVisit:  startsAts.length > 0 ? new Date(Math.min(...startsAts)) : null,
    lastVisit:   startsAts.length > 0 ? new Date(Math.max(...startsAts)) : null,
  };

  // ── Build appointment list ───────────────────────────────────────────────────
  const appointments: PatientHistoryAppointment[] = apptRows.map((a) => {
    const intake = intakeMap.get(a.id) ?? null;
    return {
      id:          a.id,
      serviceId:   a.service_id,
      serviceName: serviceNameMap.get(a.service_id) ?? a.service_id,
      startsAt:    new Date(a.starts_at),
      status:      a.status as AppointmentStatus,
      hasIntake:   a.intake_id !== null,
      intakeId:    a.intake_id,
      intakeData:  intake,
    };
  });

  return { patient: summary, appointments };
}

// ─── getMonthlyMetrics ─────────────────────────────────────────────────────────

// ─── Internal row types ────────────────────────────────────────────────────────

type AppointmentSummaryRow = {
  id: string;
  patient_id: string | null;
  service_id: string;
  status: string;
};

type PriorPatientRow = {
  patient_id: string;
};

/**
 * Calcula las métricas del mes `year/month` para el reporte mensual automático.
 *
 * Realiza 3 queries:
 *  1. Todas las citas del mes (excluyendo emergency_blocked)
 *  2. Citas completadas del mes anterior (para comparativo)
 *  3. Citas previas al mes para los pacientes únicos del mes actual (nuevo vs recurrente)
 *
 * @param serviceNameMap - serviceId → nombre del servicio, construido por el API Route
 *                         desde clientConfig.services. El engine nunca importa client.config.
 */
export async function getMonthlyMetrics(params: {
  readonly clientId: string;
  /** Año del reporte (ej: 2026) */
  readonly year: number;
  /** Mes del reporte: 1 = enero … 12 = diciembre */
  readonly month: number;
  readonly serviceNameMap: ReadonlyMap<string, string>;
  readonly supabase: SupabaseClient;
}): Promise<MonthlyMetrics> {
  const { clientId, year, month, serviceNameMap, supabase } = params;

  // ── Date ranges ──────────────────────────────────────────────────────────────
  const monthStart    = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd      = new Date(Date.UTC(year, month, 1));        // exclusive upper bound
  const prevMonth     = month === 1 ? 12 : month - 1;
  const prevYear      = month === 1 ? year - 1 : year;
  const prevMonthStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1));
  const prevMonthEnd  = monthStart;                                // exclusive upper bound

  const monthStartISO     = monthStart.toISOString();
  const monthEndISO       = monthEnd.toISOString();
  const prevMonthStartISO = prevMonthStart.toISOString();
  const prevMonthEndISO   = prevMonthEnd.toISOString();

  // ── 1. Current month appointments ────────────────────────────────────────────
  const { data: currentData, error: currentError } = await supabase
    .from('appointments')
    .select('id, patient_id, service_id, status')
    .eq('client_id', clientId)
    .neq('status', 'emergency_blocked')
    .gte('starts_at', monthStartISO)
    .lt('starts_at', monthEndISO);

  if (currentError) {
    throw new Error(`getMonthlyMetrics: failed to fetch current month — ${currentError.message}`);
  }

  const currentRows = (currentData ?? []) as AppointmentSummaryRow[];
  const completedRows = currentRows.filter((r) => r.status === 'completed');
  const noShowRows    = currentRows.filter((r) => r.status === 'no_show');

  const completed      = completedRows.length;
  const totalScheduled = currentRows.length;
  const noShows        = noShowRows.length;
  const noShowRate     = totalScheduled > 0 ? noShows / totalScheduled : 0;

  // ── 2. Previous month completed (comparativo) ─────────────────────────────────
  const { data: prevData, error: prevError } = await supabase
    .from('appointments')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .gte('starts_at', prevMonthStartISO)
    .lt('starts_at', prevMonthEndISO);

  if (prevError) {
    throw new Error(`getMonthlyMetrics: failed to fetch previous month — ${prevError.message}`);
  }

  const previousCompleted = (prevData ?? []).length;
  const completedDelta    = completed - previousCompleted;
  const completedDeltaPct =
    previousCompleted > 0 ? Math.round((completedDelta / previousCompleted) * 100) : 0;

  // ── Top services ──────────────────────────────────────────────────────────────
  const serviceCountMap = new Map<string, number>();
  for (const row of completedRows) {
    serviceCountMap.set(row.service_id, (serviceCountMap.get(row.service_id) ?? 0) + 1);
  }

  const topServices: ServiceCount[] = Array.from(serviceCountMap.entries())
    .map(([serviceId, count]) => ({
      serviceId,
      serviceName: serviceNameMap.get(serviceId) ?? serviceId,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // ── New vs returning patients ──────────────────────────────────────────────────
  const patientIds = completedRows
    .map((r) => r.patient_id)
    .filter((id): id is string => id !== null);

  let newPatients = 0;
  let returningPatients = 0;

  if (patientIds.length > 0) {
    const uniquePatientIds = Array.from(new Set(patientIds));

    // Guard: find patients who had any prior appointment before this month
    const { data: priorData, error: priorError } = await supabase
      .from('appointments')
      .select('patient_id')
      .eq('client_id', clientId)
      .in('patient_id', uniquePatientIds)
      .lt('starts_at', monthStartISO)
      .neq('status', 'emergency_blocked');

    if (priorError) {
      throw new Error(`getMonthlyMetrics: failed to fetch prior appointments — ${priorError.message}`);
    }

    const priorPatientSet = new Set(
      ((priorData ?? []) as PriorPatientRow[]).map((r) => r.patient_id),
    );

    for (const pid of uniquePatientIds) {
      if (priorPatientSet.has(pid)) {
        returningPatients++;
      } else {
        newPatients++;
      }
    }
  }

  return {
    clientId,
    year,
    month,
    completed,
    totalScheduled,
    noShows,
    noShowRate,
    topServices,
    newPatients,
    returningPatients,
    previousCompleted,
    completedDelta,
    completedDeltaPct,
  };
}

// ─── getOccupancyHeatmap ───────────────────────────────────────────────────────

type HeatmapAppointmentRow = { starts_at: string; status: string };

/**
 * Calcula la tasa de ocupación por día de semana y hora para el rango dado.
 * Agrupa en JavaScript — no requiere RPC SQL.
 *
 * @returns Array de celdas con datos (solo combinaciones día/hora con citas).
 *   day: DOW (0=dom…6=sab), hour: 0–23, pct: % citas completadas / total.
 *   Celdas sin citas históricas NO se incluyen — el componente las muestra como "Sin datos históricos".
 */
export async function getOccupancyHeatmap(params: {
  readonly clientId: string;
  readonly from: Date;
  readonly to: Date;
  readonly supabase: SupabaseClient;
}): Promise<ReadonlyArray<{ readonly day: number; readonly hour: number; readonly pct: number }>> {
  const { clientId, from, to, supabase } = params;

  const { data, error } = await supabase
    .from('appointments')
    .select('starts_at, status')
    .eq('client_id', clientId)
    .neq('status', 'emergency_blocked')
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString());

  if (error) {
    throw new Error(`getOccupancyHeatmap: ${error.message}`);
  }

  type CellAcc = { completed: number; total: number };
  const accMap = new Map<string, CellAcc>();

  for (const row of (data ?? []) as HeatmapAppointmentRow[]) {
    const d    = new Date(row.starts_at);
    const day  = d.getUTCDay();
    const hour = d.getUTCHours();
    const key  = `${day}:${hour}`;
    const acc  = accMap.get(key) ?? { completed: 0, total: 0 };
    accMap.set(key, {
      completed: acc.completed + (row.status === 'completed' ? 1 : 0),
      total:     acc.total + 1,
    });
  }

  const result: Array<{ day: number; hour: number; pct: number }> = [];
  for (const [key, acc] of accMap) {
    const sepIdx = key.indexOf(':');
    const day    = parseInt(key.slice(0, sepIdx), 10);
    const hour   = parseInt(key.slice(sepIdx + 1), 10);
    const pct    = Math.round((acc.completed / acc.total) * 100);
    result.push({ day, hour, pct });
  }

  return result;
}

// ─── getAnalyticsMetrics ───────────────────────────────────────────────────────

type BotConversationRow = { patient_phone: string; last_message: string };
type PatientPhoneRow = { phone: string };
type SparkAppointmentRow = { starts_at: string; status: string; patient_id: string | null };

/**
 * Calcula métricas de analytics para un rango de fechas arbitrario.
 *
 * Realiza 7 queries:
 *  1. Citas del período actual
 *  2. Citas del período anterior (comparativo)
 *  3. Citas previas al período para clasificar pacientes nuevos vs recurrentes
 *  4. Conversaciones del bot en el período
 *  5. Teléfonos de pacientes con cita agendada en el período (para booked via bot)
 *  6. Citas completadas en los 7 días anteriores a `to` (sparkline)
 *  7. Conteo de pacientes en riesgo (sin cita en más de `riskThresholdDays` días)
 *
 * @param servicePriceMap - serviceId → precio en MXN. Construido por el API Route
 *                          desde clientConfig.services. 0 si el servicio no tiene precio.
 */
export async function getAnalyticsMetrics(params: {
  readonly clientId: string;
  readonly from: Date;
  readonly to: Date;
  readonly serviceNameMap: ReadonlyMap<string, string>;
  readonly servicePriceMap: ReadonlyMap<string, number>;
  readonly riskThresholdDays: number;
  readonly supabase: SupabaseClient;
}): Promise<AnalyticsMetrics> {
  const { clientId, from, to, serviceNameMap, servicePriceMap, riskThresholdDays, supabase } =
    params;

  const fromISO = from.toISOString();
  const toISO   = to.toISOString();

  // ── Previous period (same duration) ─────────────────────────────────────────
  const durationMs  = to.getTime() - from.getTime();
  const prevFrom    = new Date(from.getTime() - durationMs);
  const prevFromISO = prevFrom.toISOString();

  // ── 1. Current period appointments ──────────────────────────────────────────
  const { data: currentData, error: currentError } = await supabase
    .from('appointments')
    .select('id, patient_id, service_id, status')
    .eq('client_id', clientId)
    .neq('status', 'emergency_blocked')
    .gte('starts_at', fromISO)
    .lt('starts_at', toISO);

  if (currentError) {
    throw new Error(`getAnalyticsMetrics: current period — ${currentError.message}`);
  }

  const currentRows    = (currentData ?? []) as AppointmentSummaryRow[];
  const completedRows  = currentRows.filter((r) => r.status === 'completed');
  const noShowRows     = currentRows.filter((r) => r.status === 'no_show');
  const completed      = completedRows.length;
  const totalScheduled = currentRows.length;
  const noShows        = noShowRows.length;
  const noShowRate     = totalScheduled > 0 ? noShows / totalScheduled : 0;

  // ── 2. Previous period completed ─────────────────────────────────────────────
  const { data: prevData, error: prevError } = await supabase
    .from('appointments')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .gte('starts_at', prevFromISO)
    .lt('starts_at', fromISO);

  if (prevError) {
    throw new Error(`getAnalyticsMetrics: previous period — ${prevError.message}`);
  }

  const previousCompleted = (prevData ?? []).length;
  const completedDelta    = completed - previousCompleted;
  const completedDeltaPct =
    previousCompleted > 0 ? Math.round((completedDelta / previousCompleted) * 100) : 0;

  // ── Top services + revenue ────────────────────────────────────────────────────
  const serviceCountMap = new Map<string, number>();
  let revenueEstimated  = 0;

  for (const row of completedRows) {
    serviceCountMap.set(row.service_id, (serviceCountMap.get(row.service_id) ?? 0) + 1);
    revenueEstimated += servicePriceMap.get(row.service_id) ?? 0;
  }

  const topServices: ServiceCount[] = Array.from(serviceCountMap.entries())
    .map(([serviceId, count]) => ({
      serviceId,
      serviceName: serviceNameMap.get(serviceId) ?? serviceId,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // ── New vs returning patients ──────────────────────────────────────────────────
  const patientIds      = completedRows
    .map((r) => r.patient_id)
    .filter((id): id is string => id !== null);
  const uniquePatientIds = Array.from(new Set(patientIds));

  let newPatients       = 0;
  let returningPatients = 0;
  // priorSet is hoisted here so sparkline computation can reference it
  let priorSet = new Set<string>();

  if (uniquePatientIds.length > 0) {
    const { data: priorData, error: priorError } = await supabase
      .from('appointments')
      .select('patient_id')
      .eq('client_id', clientId)
      .in('patient_id', uniquePatientIds)
      .lt('starts_at', fromISO)
      .neq('status', 'emergency_blocked');

    if (priorError) {
      throw new Error(`getAnalyticsMetrics: prior appointments — ${priorError.message}`);
    }

    priorSet = new Set(
      ((priorData ?? []) as PriorPatientRow[]).map((r) => r.patient_id),
    );

    for (const pid of uniquePatientIds) {
      if (priorSet.has(pid)) {
        returningPatients++;
      } else {
        newPatients++;
      }
    }
  }

  // ── 4. Bot conversations ──────────────────────────────────────────────────────
  const { data: botData, error: botError } = await supabase
    .from('bot_conversations')
    .select('patient_phone, last_message')
    .eq('client_id', clientId)
    .gte('last_message', fromISO)
    .lt('last_message', toISO);

  if (botError) {
    throw new Error(`getAnalyticsMetrics: bot conversations — ${botError.message}`);
  }

  const botPhones = new Set(
    ((botData ?? []) as BotConversationRow[]).map((r) => r.patient_phone),
  );
  const botTotal = botPhones.size;

  // ── 5. Patients who booked (have appointment) AND had a bot conversation ─────
  let botBooked = 0;
  if (botPhones.size > 0) {
    const { data: patientPhoneData, error: phoneError } = await supabase
      .from('patients')
      .select('phone')
      .eq('client_id', clientId)
      .in('id', uniquePatientIds.length > 0 ? uniquePatientIds : ['__none__']);

    if (phoneError) {
      throw new Error(`getAnalyticsMetrics: patient phones — ${phoneError.message}`);
    }

    for (const row of (patientPhoneData ?? []) as PatientPhoneRow[]) {
      if (botPhones.has(row.phone)) botBooked++;
    }
  }

  // ── 6. Sparklines — últimos 7 días naturales hasta `to` por métrica ──────────
  const sparklineEnd   = new Date(to);
  const sparklineStart = new Date(to.getTime() - 7 * 24 * 60 * 60_000);

  const { data: sparkData, error: sparkError } = await supabase
    .from('appointments')
    .select('starts_at, status, patient_id')
    .eq('client_id', clientId)
    .in('status', ['completed', 'no_show'])
    .gte('starts_at', sparklineStart.toISOString())
    .lt('starts_at', sparklineEnd.toISOString());

  if (sparkError) {
    throw new Error(`getAnalyticsMetrics: sparkline — ${sparkError.message}`);
  }

  // Build per-metric sparkline maps (day-offset 0–6 = oldest…newest)
  const sparkCompletedMap   = new Map<number, number>();
  const sparkNoShowsMap     = new Map<number, number>();
  const sparkNewPatientSets = new Map<number, Set<string>>();

  for (const row of (sparkData ?? []) as SparkAppointmentRow[]) {
    const rowDate   = new Date(row.starts_at);
    const dayOffset = Math.floor(
      (rowDate.getTime() - sparklineStart.getTime()) / (24 * 60 * 60_000),
    );
    if (dayOffset < 0 || dayOffset >= 7) continue;

    if (row.status === 'completed') {
      sparkCompletedMap.set(dayOffset, (sparkCompletedMap.get(dayOffset) ?? 0) + 1);
      // Guard: only count as new patient if patient_id not in prior set (approximate)
      if (row.patient_id !== null && !priorSet.has(row.patient_id)) {
        const set = sparkNewPatientSets.get(dayOffset) ?? new Set<string>();
        set.add(row.patient_id);
        sparkNewPatientSets.set(dayOffset, set);
      }
    } else if (row.status === 'no_show') {
      sparkNoShowsMap.set(dayOffset, (sparkNoShowsMap.get(dayOffset) ?? 0) + 1);
    }
  }

  // Bot chats sparkline — uses botData already fetched (filtered by analytics period)
  const sparkBotMap = new Map<number, number>();
  for (const row of (botData ?? []) as BotConversationRow[]) {
    const msgDate   = new Date(row.last_message);
    const dayOffset = Math.floor(
      (msgDate.getTime() - sparklineStart.getTime()) / (24 * 60 * 60_000),
    );
    if (dayOffset >= 0 && dayOffset < 7) {
      sparkBotMap.set(dayOffset, (sparkBotMap.get(dayOffset) ?? 0) + 1);
    }
  }

  const completedSparkline: number[] = Array.from({ length: 7 }, (_, i) => sparkCompletedMap.get(i) ?? 0);
  const sparklines = {
    completed:   Array.from({ length: 7 }, (_, i) => sparkCompletedMap.get(i) ?? 0),
    newPatients: Array.from({ length: 7 }, (_, i) => sparkNewPatientSets.get(i)?.size ?? 0),
    noShows:     Array.from({ length: 7 }, (_, i) => sparkNoShowsMap.get(i) ?? 0),
    botChats:    Array.from({ length: 7 }, (_, i) => sparkBotMap.get(i) ?? 0),
  } as const;

  // ── 7. At-risk count + 8. Heatmap — en paralelo (independientes) ─────────────
  const riskCutoff = new Date(Date.now() - riskThresholdDays * 24 * 60 * 60_000);

  const [
    { count: atRiskCount, error: riskError },
    heatmap,
  ] = await Promise.all([
    supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .not('last_visit', 'is', null)
      .lt('last_visit', riskCutoff.toISOString()),
    getOccupancyHeatmap({ clientId, from, to, supabase }),
  ]);

  if (riskError) {
    throw new Error(`getAnalyticsMetrics: at-risk count — ${riskError.message}`);
  }

  return {
    clientId,
    from,
    to,
    completed,
    totalScheduled,
    noShows,
    noShowRate,
    topServices,
    newPatients,
    returningPatients,
    previousCompleted,
    completedDelta,
    completedDeltaPct,
    botConversions: { total: botTotal, booked: botBooked },
    revenueEstimated,
    currency: 'MXN',
    completedSparkline,
    sparklines,
    heatmap,
    atRiskPatientCount: atRiskCount ?? 0,
  };
}

// ─── getAtRiskPatients ─────────────────────────────────────────────────────────

type PatientRow2 = {
  id: string;
  name: string;
  phone: string;
  last_visit: string | null;
};

/**
 * Retorna los pacientes en riesgo de abandono: sin cita en más de `daysSinceLastVisit` días.
 * Limitado a `limit` registros, ordenados por `last_visit` ascendente (más rezagados primero).
 */
export async function getAtRiskPatients(params: {
  readonly clientId: string;
  readonly daysSinceLastVisit: number;
  readonly limit: number;
  readonly supabase: SupabaseClient;
}): Promise<readonly AtRiskPatient[]> {
  const { clientId, daysSinceLastVisit, limit, supabase } = params;
  const cutoff = new Date(Date.now() - daysSinceLastVisit * 24 * 60 * 60_000);

  const { data, error } = await supabase
    .from('patients')
    .select('id, name, phone, last_visit')
    .eq('client_id', clientId)
    .not('last_visit', 'is', null)
    .lt('last_visit', cutoff.toISOString())
    .order('last_visit', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`getAtRiskPatients: ${error.message}`);
  }

  const now = Date.now();

  return ((data ?? []) as PatientRow2[]).map((row) => {
    const lastVisit = row.last_visit ? new Date(row.last_visit) : null;
    const daysSince = lastVisit
      ? Math.floor((now - lastVisit.getTime()) / (24 * 60 * 60_000))
      : daysSinceLastVisit;

    // Derive initials from name (first two words)
    const parts    = row.name.trim().split(/\s+/);
    const initials =
      parts.length >= 2
        ? `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
        : (parts[0]?.[0] ?? '?').toUpperCase();

    return { id: row.id, name: row.name, phone: row.phone, initials, lastVisit, daysSinceLastVisit: daysSince };
  });
}
