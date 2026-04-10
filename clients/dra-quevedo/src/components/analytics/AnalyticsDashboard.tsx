'use client';

// ─── AnalyticsDashboard ────────────────────────────────────────────────────────
// Client Component que ensambla todos los componentes de analytics.
// Maneja el estado del período seleccionado y re-fetcha vía API Route
// cuando cambia el PeriodSelector.
//
// Layout (gap 8px entre cards):
//   [PeriodSelector]
//   [AlertBanner × N]
//   [KPICard × 4] — grid 4 columnas
//   [ServicesChart | PatientTypeDonut] — grid 1.55fr / 1fr
//   [OccupancyHeatmap | PatientAttentionList] — grid 2 columnas
//   [OccupancyGauge | RevenueCard | BotConversionCard] — grid 3 columnas

import { useState, useCallback } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type {
  SerializedAnalyticsMetrics,
  SerializedAlertData,
  SerializedAtRiskPatient,
  Period,
  HeatmapCell,
} from './types';

import { PeriodSelector }       from './PeriodSelector';
import { AlertBanner }          from './AlertBanner';
import { KPICard }              from './KPICard';
import { ServicesChart }        from './ServicesChart';
import { PatientTypeDonut }     from './PatientTypeDonut';
import { OccupancyHeatmap }     from './OccupancyHeatmap';
import { PatientAttentionList } from './PatientAttentionList';
import { OccupancyGauge }       from './OccupancyGauge';
import { RevenueCard }          from './RevenueCard';
import { BotConversionCard }    from './BotConversionCard';

// ─── Mock heatmap ──────────────────────────────────────────────────────────────
// TODO: reemplazar con query de ocupación histórica (ver CLAUDE.md — open decisions)

const MOCK_HEATMAP: HeatmapCell[] = [
  { day: 0, hour: '09:00', pct: 55 }, { day: 1, hour: '09:00', pct: 72 },
  { day: 2, hour: '09:00', pct: 45 }, { day: 3, hour: '09:00', pct: 88 },
  { day: 4, hour: '09:00', pct: 60 },
  { day: 0, hour: '10:00', pct: 94 }, { day: 1, hour: '10:00', pct: 85 },
  { day: 2, hour: '10:00', pct: 78 }, { day: 3, hour: '10:00', pct: 91 },
  { day: 4, hour: '10:00', pct: 82 },
  { day: 0, hour: '11:00', pct: 88 }, { day: 1, hour: '11:00', pct: 75 },
  { day: 2, hour: '11:00', pct: 68 }, { day: 3, hour: '11:00', pct: 80 },
  { day: 4, hour: '11:00', pct: 72 },
  { day: 0, hour: '12:00', pct: 62 }, { day: 1, hour: '12:00', pct: 58 },
  { day: 2, hour: '12:00', pct: 40 }, { day: 3, hour: '12:00', pct: 55 },
  { day: 4, hour: '12:00', pct: 48 },
  { day: 0, hour: '14:00', pct: 78 }, { day: 1, hour: '14:00', pct: 85 },
  { day: 2, hour: '14:00', pct: 92 }, { day: 3, hour: '14:00', pct: 70 },
  { day: 4, hour: '14:00', pct: 65 },
  { day: 0, hour: '16:00', pct: 70 }, { day: 1, hour: '16:00', pct: 65 },
  { day: 2, hour: '16:00', pct: 80 }, { day: 3, hour: '16:00', pct: 88 },
  { day: 4, hour: '16:00', pct: 75 },
  { day: 0, hour: '18:00', pct: 35 }, { day: 1, hour: '18:00', pct: 42 },
  { day: 2, hour: '18:00', pct: 30 }, { day: 3, hour: '18:00', pct: 50 },
  { day: 4, hour: '18:00', pct: 28 },
];

// ─── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  readonly initialMetrics: SerializedAnalyticsMetrics;
  readonly initialAlerts: readonly SerializedAlertData[];
  readonly initialAtRiskPatients: readonly SerializedAtRiskPatient[];
  readonly initialPeriod: Period;
  readonly clientId: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtPct(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** Calcula la ocupación del período como % de citas completadas vs agendadas. */
function calcOccupancyPct(metrics: SerializedAnalyticsMetrics): number {
  if (metrics.totalScheduled === 0) return 0;
  return Math.round((metrics.completed / metrics.totalScheduled) * 100);
}

// ─── AnalyticsDashboard ────────────────────────────────────────────────────────

export function AnalyticsDashboard({
  initialMetrics,
  initialAlerts,
  initialAtRiskPatients,
  initialPeriod,
  clientId,
}: Props) {
  const [period, setPeriod]           = useState<Period>(initialPeriod);
  const [metrics, setMetrics]         = useState(initialMetrics);
  const [alerts, setAlerts]           = useState(initialAlerts);
  const [atRisk, setAtRisk]           = useState(initialAtRiskPatients);
  const [loading, setLoading]         = useState(false);

  // Refetch cuando cambia el período
  const handlePeriodChange = useCallback(async (p: Period) => {
    setPeriod(p);
    setLoading(true);

    try {
      // Obtener token de sesión — mismo patrón que PatientHistoryDrawer
      const supabase = createSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      const auth = session ? `Bearer ${session.access_token}` : '';

      const res = await fetch(`/api/analytics?period=${p}`, {
        headers: { 'Content-Type': 'application/json', Authorization: auth },
      });

      if (!res.ok) return;

      const data = await res.json() as {
        metrics: SerializedAnalyticsMetrics;
        alerts: SerializedAlertData[];
        atRiskPatients: SerializedAtRiskPatient[];
      };

      setMetrics(data.metrics);
      setAlerts(data.alerts);
      setAtRisk(data.atRiskPatients);
    } catch {
      // Mantener datos anteriores si falla el fetch
    } finally {
      setLoading(false);
    }
  }, []);

  const occupancyPct = calcOccupancyPct(metrics);
  const totalPatients = metrics.newPatients + metrics.returningPatients;

  // Revenue goal: mock hasta tener config de metas
  const revenueGoal = 50_000;

  // KPI sparklines: completedSparkline del engine (7 días)
  const spark = [...metrics.completedSparkline] as number[];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        opacity: loading ? 0.6 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {/* ── PeriodSelector ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '4px' }}>
        <PeriodSelector period={period} onChange={handlePeriodChange} />
      </div>

      {/* ── AlertBanners ───────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {alerts.map((alert, i) => (
            <AlertBanner key={i} {...alert} />
          ))}
        </div>
      )}

      {/* ── KPI Grid — 4 columnas ──────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '8px',
        }}
      >
        <KPICard
          label="Citas completadas"
          value={String(metrics.completed)}
          delta={fmtPct(metrics.completedDeltaPct)}
          direction={metrics.completedDelta > 0 ? 'up' : metrics.completedDelta < 0 ? 'down' : 'neutral'}
          sparkline={spark}
        />
        <KPICard
          label="Nuevos pacientes"
          value={String(metrics.newPatients)}
          delta={totalPatients > 0 ? `${Math.round((metrics.newPatients / totalPatients) * 100)}% del total` : '—'}
          direction="neutral"
          sparkline={[0, 0, 0, 0, 0, 0, metrics.newPatients]} // TODO: sparkline propio de pacientes nuevos
        />
        <KPICard
          label="No-shows"
          value={String(metrics.noShows)}
          delta={`${Math.round(metrics.noShowRate * 100)}% de citas`}
          direction={metrics.noShowRate > 0.15 ? 'down' : metrics.noShows === 0 ? 'up' : 'neutral'}
          sparkline={[0, 0, 0, 0, 0, 0, metrics.noShows]} // TODO: sparkline propio de no-shows
        />
        <KPICard
          label="Ingresos estimados"
          value={fmtMXN(metrics.revenueEstimated)}
          delta={fmtPct(metrics.completedDeltaPct)}
          direction={metrics.completedDelta > 0 ? 'up' : metrics.completedDelta < 0 ? 'down' : 'neutral'}
          sparkline={spark}
        />
      </div>

      {/* ── ServicesChart + PatientTypeDonut ──────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.55fr 1fr',
          gap: '8px',
        }}
      >
        <ServicesChart
          services={metrics.topServices.map((s) => ({
            name: s.serviceName,
            count: s.count,
            total: metrics.completed,
          }))}
        />
        <PatientTypeDonut
          recurring={metrics.returningPatients}
          new={metrics.newPatients}
        />
      </div>

      {/* ── OccupancyHeatmap + PatientAttentionList ───────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
        }}
      >
        <OccupancyHeatmap data={MOCK_HEATMAP} />
        <PatientAttentionList patients={atRisk} />
      </div>

      {/* ── OccupancyGauge + RevenueCard + BotConversionCard ─────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
        }}
      >
        <OccupancyGauge
          pct={occupancyPct}
          slots={`${metrics.completed} de ${metrics.totalScheduled} slots`}
        />
        <RevenueCard
          value={fmtMXN(metrics.revenueEstimated)}
          breakdown={`${metrics.completed} citas · ${metrics.currency}`}
          achieved={metrics.revenueEstimated}
          goal={revenueGoal}
          trend={spark}
        />
        <BotConversionCard
          chats={metrics.botConversions.total}
          booked={metrics.botConversions.booked}
        />
      </div>
    </div>
  );
}
