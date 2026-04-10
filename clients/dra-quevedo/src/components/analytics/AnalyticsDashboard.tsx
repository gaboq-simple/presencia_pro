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

import { useState, useCallback, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type {
  SerializedAnalyticsMetrics,
  SerializedAlertData,
  SerializedAtRiskPatient,
  Period,
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


// ─── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  readonly initialMetrics: SerializedAnalyticsMetrics;
  readonly initialAlerts: readonly SerializedAlertData[];
  readonly initialAtRiskPatients: readonly SerializedAtRiskPatient[];
  readonly initialPeriod: Period;
  readonly clientId: string;
  readonly revenueGoal?: number;
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
  revenueGoal,
}: Props) {
  const [period, setPeriod]           = useState<Period>(initialPeriod);
  const [metrics, setMetrics]         = useState(initialMetrics);
  const [alerts, setAlerts]           = useState(initialAlerts);
  const [atRisk, setAtRisk]           = useState(initialAtRiskPatients);
  const [loading, setLoading]         = useState(false);
  const [isDark, setIsDark]           = useState(false);

  // ── Inicializar tema desde localStorage (post-mount, sin hydration mismatch) ──
  useEffect(() => {
    const saved = localStorage.getItem('presenciapro-theme');
    const dark = saved === 'dark';
    setIsDark(dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
  }, []);

  const handleThemeToggle = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      const value = next ? 'dark' : '';
      document.documentElement.setAttribute('data-theme', value);
      localStorage.setItem('presenciapro-theme', value);
      return next;
    });
  }, []);

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
      {/* ── PeriodSelector + Dark mode toggle ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <PeriodSelector period={period} onChange={handlePeriodChange} />
        <button
          onClick={handleThemeToggle}
          aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            border: '1px solid var(--an-br)',
            backgroundColor: 'var(--an-card)',
            color: 'var(--an-t2)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
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
          sparkline={[...metrics.sparklines.completed]}
        />
        <KPICard
          label="Nuevos pacientes"
          value={String(metrics.newPatients)}
          delta={totalPatients > 0 ? `${Math.round((metrics.newPatients / totalPatients) * 100)}% del total` : '—'}
          direction="neutral"
          sparkline={[...metrics.sparklines.newPatients]}
        />
        <KPICard
          label="No-shows"
          value={String(metrics.noShows)}
          delta={`${Math.round(metrics.noShowRate * 100)}% de citas`}
          direction={metrics.noShowRate > 0.15 ? 'down' : metrics.noShows === 0 ? 'up' : 'neutral'}
          sparkline={[...metrics.sparklines.noShows]}
        />
        <KPICard
          label="Ingresos estimados"
          value={fmtMXN(metrics.revenueEstimated)}
          delta={fmtPct(metrics.completedDeltaPct)}
          direction={metrics.completedDelta > 0 ? 'up' : metrics.completedDelta < 0 ? 'down' : 'neutral'}
          sparkline={[...metrics.sparklines.completed]}
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
        <OccupancyHeatmap data={metrics.heatmap} />
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
          trend={[...metrics.sparklines.completed]}
        />
        <BotConversionCard
          chats={metrics.botConversions.total}
          booked={metrics.botConversions.booked}
        />
      </div>
    </div>
  );
}
