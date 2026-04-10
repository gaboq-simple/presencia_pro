// ─── Analytics Component Types ─────────────────────────────────────────────────
// Tipos compartidos entre los componentes del dashboard de analytics.
// Son view-model types — no son tipos del engine. Las Dates vienen serializadas
// como ISO strings desde el Server Component / API Route.

export type Period = 'hoy' | 'semana' | 'mes';

export type AlertType = 'warn' | 'ok' | 'info';

export interface SerializedAlertData {
  readonly type: AlertType;
  readonly title: string;
  readonly subtitle: string;
  readonly chip: string;
}

export interface SerializedServiceCount {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly count: number;
}

export interface SerializedAnalyticsMetrics {
  readonly clientId: string;
  readonly from: string;              // ISO string
  readonly to: string;               // ISO string
  readonly completed: number;
  readonly totalScheduled: number;
  readonly noShows: number;
  readonly noShowRate: number;
  readonly topServices: readonly SerializedServiceCount[];
  readonly newPatients: number;
  readonly returningPatients: number;
  readonly previousCompleted: number;
  readonly completedDelta: number;
  readonly completedDeltaPct: number;
  readonly botConversions: {
    readonly total: number;
    readonly booked: number;
  };
  readonly revenueEstimated: number;
  readonly currency: 'MXN';
  readonly completedSparkline: readonly number[];
  /** Sparklines individuales por métrica — 7 puntos, últimos 7 días hasta `to`. */
  readonly sparklines: {
    readonly completed:   readonly number[];
    readonly newPatients: readonly number[];
    readonly noShows:     readonly number[];
    readonly botChats:    readonly number[];
  };
  /** Ocupación histórica por día/hora. Solo celdas con datos. */
  readonly heatmap: ReadonlyArray<{ readonly day: number; readonly hour: number; readonly pct: number }>;
  readonly atRiskPatientCount: number;
}

export interface SerializedAtRiskPatient {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly initials: string;
  readonly lastVisit: string | null;  // ISO string or null
  readonly daysSinceLastVisit: number;
}

/** Celda del heatmap de ocupación — datos reales de DB. */
export interface HeatmapCell {
  readonly day: number;   // DOW: 0=dom … 6=sab
  readonly hour: number;  // 0–23
  readonly pct: number;   // 0–100
}
