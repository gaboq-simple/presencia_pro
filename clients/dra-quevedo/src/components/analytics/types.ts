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

/** Datos mock del heatmap de ocupación hasta tener query histórica */
export interface HeatmapCell {
  readonly day: number;     // 0=lunes … 4=viernes
  readonly hour: string;    // "09:00"
  readonly pct: number;     // 0–100
}
