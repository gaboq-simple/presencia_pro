// ─── Dashboard Types ───────────────────────────────────────────────────────────
// Shared types for the dashboard module. These are view-model types — they
// combine data from multiple DB tables into structures ready for rendering.
// They are NOT persistence types (use scheduling/types.ts for those).

import type { Appointment, AppointmentStatus } from '../scheduling/types';

// Re-export for consumers who import from this module
export type { Appointment, AppointmentStatus };

// ─── Intake data ───────────────────────────────────────────────────────────────

/**
 * A single rendered field from the intake form.
 * The `label` is the human-readable Spanish label for the field key.
 */
export interface IntakeField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/**
 * Complete intake data for a single appointment.
 * `null` means the patient has not filled the intake form yet.
 */
export interface IntakeData {
  readonly id: string;
  readonly fields: readonly IntakeField[];
  readonly signedAt: Date | null;
}

// ─── Appointment view model ────────────────────────────────────────────────────

/**
 * An appointment enriched with patient name and intake data.
 * Produced by the dashboard page's data-fetching layer and passed to DayView.
 */
export interface AppointmentWithPatient {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: AppointmentStatus;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly serviceMode: 'domicilio' | 'consultorio';
  readonly specialistId: string;
  readonly patientId: string | null;
  readonly patientName: string | null;
  readonly intakeData: IntakeData | null;
}

// ─── Emergency slot ────────────────────────────────────────────────────────────

/**
 * A slot currently blocked for emergency use.
 * Shown as a top-priority card in the dashboard so the doctor can release it
 * if a real urgent patient arrives.
 */
export interface EmergencySlot {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly specialistId: string;
}

// ─── Patient history (medical profile only) ────────────────────────────────────
// Fetched by getPatientHistory() and rendered in PatientHistoryDrawer.
// intakeData is loaded eagerly in the same query so the drawer can expand
// IntakeViewer inline without a second round-trip.

export interface PatientHistorySummary {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly firstVisit: Date | null;
  readonly totalVisits: number;
  readonly lastVisit: Date | null;
}

export interface PatientHistoryAppointment {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly startsAt: Date;
  readonly status: AppointmentStatus;
  readonly hasIntake: boolean;
  readonly intakeId: string | null;
  /** Pre-loaded intake fields — null if the patient has not filled the form. */
  readonly intakeData: IntakeData | null;
}

export interface PatientHistory {
  readonly patient: PatientHistorySummary;
  readonly appointments: readonly PatientHistoryAppointment[];
}

// ─── Analytics types ───────────────────────────────────────────────────────────

/**
 * Alerta generada dinámicamente desde los datos de analytics.
 * Producida por generateAlerts() — no contiene strings hardcodeados de negocio.
 */
export interface AlertData {
  readonly type: 'warn' | 'ok' | 'info';
  readonly title: string;
  readonly subtitle: string;
  readonly chip: string;
}

/**
 * Paciente en riesgo de abandono: sin cita en N días.
 * Producido por getAtRiskPatients().
 */
export interface AtRiskPatient {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly initials: string;
  readonly lastVisit: Date | null;
  readonly daysSinceLastVisit: number;
}

/**
 * Métricas de analytics para un rango de fechas arbitrario.
 * Producido por getAnalyticsMetrics().
 */
export interface AnalyticsMetrics {
  readonly clientId: string;
  readonly from: Date;
  readonly to: Date;
  readonly completed: number;
  readonly totalScheduled: number;
  readonly noShows: number;
  readonly noShowRate: number;
  readonly topServices: readonly ServiceCount[];
  readonly newPatients: number;
  readonly returningPatients: number;
  readonly previousCompleted: number;
  readonly completedDelta: number;
  readonly completedDeltaPct: number;
  readonly botConversions: {
    readonly total: number;
    readonly booked: number;
  };
  /** Ingresos estimados en MXN. 0 si los servicios no tienen precio configurado. */
  readonly revenueEstimated: number;
  readonly currency: 'MXN';
  /**
   * Citas completadas por día para los 7 días naturales que terminan en `to`.
   * Siempre 7 elementos — índice 0 = día más antiguo, índice 6 = día más reciente.
   */
  readonly completedSparkline: readonly number[];
  /**
   * Sparklines por métrica individual — 7 puntos, últimos 7 días naturales hasta `to`.
   * Índice 0 = día más antiguo, índice 6 = día más reciente.
   */
  readonly sparklines: {
    readonly completed:   readonly number[];
    readonly newPatients: readonly number[];
    readonly noShows:     readonly number[];
    readonly botChats:    readonly number[];
  };
  /**
   * Ocupación histórica por día de semana y hora.
   * day: DOW (0=dom…6=sab), hour: 0–23, pct: 0–100.
   * Solo contiene combinaciones con al menos 1 cita en el período.
   */
  readonly heatmap: ReadonlyArray<{ readonly day: number; readonly hour: number; readonly pct: number }>;
  /** Número de pacientes sin cita en más de `riskThresholdDays` días */
  readonly atRiskPatientCount: number;
}

// ─── Monthly report metrics ────────────────────────────────────────────────────

/**
 * Conteo de citas por servicio para el top de servicios más solicitados.
 * serviceName viene del serviceNameMap inyectado por el API Route — nunca del config directamente.
 */
export interface ServiceCount {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly count: number;
}

/**
 * Métricas del mes para el reporte mensual automático.
 * Producido por getMonthlyMetrics() — sin lógica de presentación.
 * La localización (nombres de mes, formato de porcentaje) es responsabilidad del API Route.
 */
export interface MonthlyMetrics {
  readonly clientId: string;
  readonly year: number;
  /** Mes del reporte: 1 = enero … 12 = diciembre */
  readonly month: number;
  /** Citas con status = 'completed' en el mes */
  readonly completed: number;
  /** Total de citas agendadas (sin emergency_blocked) en el mes */
  readonly totalScheduled: number;
  /** Citas con status = 'no_show' en el mes */
  readonly noShows: number;
  /** noShows / totalScheduled — 0 si no hubo citas agendadas */
  readonly noShowRate: number;
  /** Top 3 servicios por conteo de citas completadas */
  readonly topServices: readonly ServiceCount[];
  /** Pacientes únicos cuya primera cita (en cualquier estado) fue en este mes */
  readonly newPatients: number;
  /** Pacientes únicos de citas completadas que ya tenían citas antes de este mes */
  readonly returningPatients: number;
  /** Citas completadas en el mes anterior (para comparativo) */
  readonly previousCompleted: number;
  /** completed − previousCompleted */
  readonly completedDelta: number;
  /** Variación porcentual redondeada a entero. 0 si previousCompleted === 0. */
  readonly completedDeltaPct: number;
}
