// ─── MetricsSummary ───────────────────────────────────────────────────────────
// Client Component — métricas del negocio por período.
//
// Responsabilidades:
//   - Selector de período: día / semana / mes.
//   - Fetch a GET /api/reports/summary?period=…&date=… al montar y al cambiar período.
//   - Revalidación automática cada 300s (sin Realtime — métricas son menos urgentes).
//   - Muestra: ingresos, total de citas, completadas, canceladas, no_show.
//   - HourlyPeaksChart — distribución por hora (8h-20h).
//   - SourceBreakdown — desglose por canal de origen.
//   - Clientes recurrentes vs nuevos.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MetricsPeriod, PeriodMetrics, DayRevenue } from '@/lib/dashboard.types';
import HourlyPeaksChart from './HourlyPeaksChart';
import SourceBreakdown from './SourceBreakdown';
import NoShowByDayChart from './NoShowByDayChart';
import TopClientsCard from './TopClientsCard';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  businessId: string;
  date: string;         // 'YYYY-MM-DD' — día ancla actual del dashboard
  initialRevenue: DayRevenue;
};

// ─── Config ───────────────────────────────────────────────────────────────────

const REVALIDATE_MS = 300_000; // 5 minutos

const PERIOD_LABELS: Record<MetricsPeriod, string> = {
  day:   'Hoy',
  week:  'Semana',
  month: 'Mes',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MetricsSummary({ businessId, date, initialRevenue }: Props) {
  const [period, setPeriod] = useState<MetricsPeriod>('day');
  const [metrics, setMetrics] = useState<PeriodMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref para el intervalo de revalidación — evita recrear el fetch al cambiar período
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async (p: MetricsPeriod, d: string) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ period: p, date: d });
      if (businessId) params.set('business_id', businessId);
      const res = await fetch(
        `/api/reports/summary?${params.toString()}`,
        { credentials: 'same-origin' },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as PeriodMetrics;
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar métricas');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch inicial y revalidación periódica
  useEffect(() => {
    void fetchMetrics(period, date);

    intervalRef.current = setInterval(() => {
      void fetchMetrics(period, date);
    }, REVALIDATE_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [period, date, fetchMetrics]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">

      {/* Header: título + selector de período */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500">Métricas</p>
        <div className="flex gap-1">
          {(['day', 'week', 'month'] as MetricsPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                period === p
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido */}
      <div className="mt-3">
        {loading && !metrics && (
          <p className="text-xs text-gray-400">Cargando...</p>
        )}

        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {metrics && (
          <div className="space-y-4">
            {/* Ingresos */}
            <div>
              <p className="text-xs text-gray-400">Ingresos</p>
              <p className={`mt-0.5 text-xl font-bold text-gray-900 ${loading ? 'opacity-50' : ''}`}>
                {formatCurrency(metrics.revenue, metrics.currency)}
              </p>
            </div>

            {/* Contadores por status */}
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Completadas" value={metrics.completed} color="text-green-700" />
              <Stat label="Canceladas"  value={metrics.cancelled} color="text-gray-500" />
              <Stat label="No asistió"  value={metrics.no_show}   color="text-red-600" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="Pendientes"  value={metrics.pending}   color="text-yellow-700" />
              <Stat label="Confirmadas" value={metrics.confirmed} color="text-blue-700" />
              <Stat label="Walk-in"     value={metrics.walkin}    color="text-purple-700" />
            </div>

            {/* Clientes recurrentes vs nuevos */}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Clientes recurrentes" value={metrics.recurring_clients} color="text-teal-700" />
              <Stat label="Clientes nuevos"       value={metrics.new_clients}       color="text-sky-700" />
            </div>

            {/* Gráfica de picos por hora */}
            <HourlyPeaksChart hourly={metrics.hourly} />

            {/* Desglose por canal */}
            <SourceBreakdown source={metrics.source} total={metrics.total} />

            {/* No-show por día de semana */}
            <NoShowByDayChart noshowByDay={metrics.noshow_by_day} period={period} />

            {/* Top clientes del período */}
            <TopClientsCard clients={metrics.top_clients} />

            {/* Total */}
            <p className="border-t border-gray-100 pt-2 text-xs text-gray-400">
              Total: <span className="font-medium text-gray-600">{metrics.total} citas</span>
            </p>
          </div>
        )}

        {/* Fallback mientras no hay métricas (primer render usa initialRevenue) */}
        {!metrics && !loading && !error && (
          <div>
            <p className="text-xs text-gray-400">Ingresos del día</p>
            <p className="mt-0.5 text-xl font-bold text-gray-900">
              {formatCurrency(initialRevenue.total, initialRevenue.currency)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              {initialRevenue.completedCount} completadas
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat sub-component ───────────────────────────────────────────────────────

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
      <p className={`text-base font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
