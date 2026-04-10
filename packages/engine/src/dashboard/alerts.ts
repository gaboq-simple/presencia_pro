// ─── Dashboard Alerts ──────────────────────────────────────────────────────────
// Genera alertas dinámicas desde las métricas de analytics.
// Cero strings hardcodeados de negocio — todos los textos vienen de los datos.
// Puro — no tiene efectos secundarios, no hace fetch.

import type { AlertData, AnalyticsMetrics } from './types';

// ─── Thresholds ────────────────────────────────────────────────────────────────

const NO_SHOW_WARN_THRESHOLD     = 0.15;   // >15% → alerta warn
const BOT_CONVERSION_INFO_THRESH = 0.45;   // <45% → alerta info

// ─── generateAlerts ────────────────────────────────────────────────────────────

/**
 * Genera alertas dinámicamente desde las métricas de analytics y la configuración
 * del cliente. Las alertas se ordenan por prioridad: warn > ok > info.
 *
 * Reglas:
 *  1. Si atRiskPatientCount > 0 → warn (pacientes en riesgo de abandono)
 *  2. Si noShowRate > 15%       → warn (tasa de no-show elevada)
 *  3. Si completedDelta > 0     → ok  (más citas que período anterior)
 *  4. Si botConversions.total > 0 && tasa < 45% → info (conversión baja del bot)
 */
export function generateAlerts(
  metrics: AnalyticsMetrics,
  config: {
    readonly riskThresholdDays: number;
    readonly botAssistantName: string;
  },
): readonly AlertData[] {
  const alerts: AlertData[] = [];

  // ── 1. Pacientes en riesgo ────────────────────────────────────────────────────
  if (metrics.atRiskPatientCount > 0) {
    const n = metrics.atRiskPatientCount;
    alerts.push({
      type: 'warn',
      title:
        n === 1
          ? '1 paciente sin cita reciente'
          : `${n} pacientes sin cita reciente`,
      subtitle: `Sin actividad en más de ${config.riskThresholdDays} días. Considera una campaña de reactivación.`,
      chip: n === 1 ? '1 paciente' : `${n} pacientes`,
    });
  }

  // ── 2. Tasa de no-show elevada ────────────────────────────────────────────────
  if (metrics.noShowRate > NO_SHOW_WARN_THRESHOLD && metrics.totalScheduled > 0) {
    const pct = Math.round(metrics.noShowRate * 100);
    alerts.push({
      type: 'warn',
      title: `${pct}% de no-shows en el período`,
      subtitle: `${metrics.noShows} de ${metrics.totalScheduled} citas no se presentaron. Considera recordatorios adicionales.`,
      chip: `${pct}% no-show`,
    });
  }

  // ── 3. Récord de citas completadas ────────────────────────────────────────────
  if (metrics.completedDelta > 0 && metrics.previousCompleted > 0) {
    const pct = Math.abs(metrics.completedDeltaPct);
    alerts.push({
      type: 'ok',
      title: `+${metrics.completedDelta} citas vs período anterior`,
      subtitle: `Un ${pct}% más que en el período equivalente anterior — ¡excelente ritmo!`,
      chip: `+${pct}%`,
    });
  }

  // ── 4. Conversión baja del bot ────────────────────────────────────────────────
  if (metrics.botConversions.total > 0) {
    const conversionRate = metrics.botConversions.booked / metrics.botConversions.total;
    if (conversionRate < BOT_CONVERSION_INFO_THRESH) {
      const pct = Math.round(conversionRate * 100);
      alerts.push({
        type: 'info',
        title: `Conversión de ${config.botAssistantName}: ${pct}%`,
        subtitle: `${metrics.botConversions.booked} de ${metrics.botConversions.total} conversaciones resultaron en cita. Revisa el mensaje de bienvenida del bot.`,
        chip: `${pct}% conversión`,
      });
    }
  }

  return alerts;
}
