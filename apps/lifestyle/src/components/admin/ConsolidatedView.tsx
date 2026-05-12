'use client';

// ─── ConsolidatedView ─────────────────────────────────────────────────────────
// Vista consolidada "Todas las sucursales" — solo visible para sesiones
// de tipo 'organization' con >1 sucursal.
//
// Muestra métricas agregadas de todas las sucursales del dueño:
//   - Totales del período (ingresos, citas, status, clientes)
//   - Comparativa entre sucursales (BranchComparisonTable)
//   - Picos por hora consolidados (HourlyPeaksChart)
//   - Desglose por canal consolidado (SourceBreakdown)
//   - No-show por día de semana consolidado (NoShowByDayChart)
//   - Top clientes globales (TopClientsCard)
//
// No muestra: agenda del día, timeline, ni staff metrics por barbero.
//
// Fetch: GET /api/reports/summary?period=…&date=…&business_id=ID1,ID2,…
// Cuando hay múltiples IDs el endpoint retorna ConsolidatedSummaryResponse.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PeriodMetrics, MetricsPeriod } from '@/lib/dashboard.types';
import type { ConsolidatedSummaryResponse, BranchSummary } from '@/app/api/reports/summary/route';
import BranchSelector from './BranchSelector';
import HourlyPeaksChart from './HourlyPeaksChart';
import SourceBreakdown from './SourceBreakdown';
import NoShowByDayChart from './NoShowByDayChart';
import TopClientsCard from './TopClientsCard';
import BranchComparisonTable from './BranchComparisonTable';

// ─── Props ────────────────────────────────────────────────────────────────────

type Branch = { id: string; name: string };

type Props = {
  organizationId: string;
  businessIds: string[];
  branches: Branch[];
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

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Subcomponent: stat card ──────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
      <p className={`text-base font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConsolidatedView({ organizationId: _organizationId, businessIds, branches }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [period, setPeriod] = useState<MetricsPeriod>('week');
  const [consolidated, setConsolidated] = useState<PeriodMetrics | null>(null);
  const [branchRows, setBranchRows] = useState<BranchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async (p: MetricsPeriod) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        period: p,
        date: todayStr(),
        business_id: businessIds.join(','),
      });
      const res = await fetch(`/api/reports/summary?${params.toString()}`, {
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      // Con múltiples IDs el endpoint retorna ConsolidatedSummaryResponse
      const data = (await res.json()) as ConsolidatedSummaryResponse;
      setConsolidated(data.consolidated);
      setBranchRows(data.branches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar metricas');
    } finally {
      setLoading(false);
    }
  }, [businessIds]);

  useEffect(() => {
    void fetchMetrics(period);

    intervalRef.current = setInterval(() => {
      void fetchMetrics(period);
    }, REVALIDATE_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [period, fetchMetrics]);

  // Navegar a una sucursal específica
  function handleBranchChange(branchId: string) {
    const params = new URLSearchParams();
    params.set('branch', branchId);
    // Preservar ?date si está presente
    const date = searchParams.get('date');
    if (date && branchId !== 'all') params.set('date', date);
    router.push(`/dashboard?${params.toString()}`);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between">
            {/* Selector de sucursal — "Todas" seleccionado */}
            <BranchSelector branches={branches} currentBranchId="all" />

            <a
              href="/staff"
              className="ml-3 shrink-0 text-xs text-gray-500 hover:text-gray-700"
            >
              Vista barbero →
            </a>
          </div>
        </div>
      </header>

      {/* ── Contenido ───────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 pb-8">

        {/* Métricas consolidadas — selector de período */}
        <div className="rounded-lg border border-gray-200 px-4 py-3">

          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">Metricas consolidadas</p>
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

          <div className="mt-3">
            {loading && !consolidated && (
              <p className="text-xs text-gray-400">Cargando...</p>
            )}

            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}

            {consolidated && (
              <div className={`space-y-4 ${loading ? 'opacity-50' : ''}`}>

                {/* Ingresos totales */}
                <div>
                  <p className="text-xs text-gray-400">Ingresos totales</p>
                  <p className="mt-0.5 text-2xl font-bold text-gray-900">
                    {formatCurrency(consolidated.revenue, consolidated.currency)}
                  </p>
                </div>

                {/* Contadores por status */}
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Completadas" value={consolidated.completed} color="text-green-700" />
                  <Stat label="Canceladas"  value={consolidated.cancelled} color="text-gray-500" />
                  <Stat label="No asistio"  value={consolidated.no_show}   color="text-red-600" />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Pendientes"  value={consolidated.pending}   color="text-yellow-700" />
                  <Stat label="Confirmadas" value={consolidated.confirmed} color="text-blue-700" />
                  <Stat label="Walk-in"     value={consolidated.walkin}    color="text-purple-700" />
                </div>

                {/* Clientes recurrentes vs nuevos */}
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Clientes recurrentes" value={consolidated.recurring_clients} color="text-teal-700" />
                  <Stat label="Clientes nuevos"       value={consolidated.new_clients}       color="text-sky-700" />
                </div>

                {/* Total */}
                <p className="text-xs text-gray-400">
                  Total: <span className="font-medium text-gray-600">{consolidated.total} citas</span>
                  {' '}en {branches.length} sucursales
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Comparativa entre sucursales */}
        {branchRows.length > 0 && (
          <div className="rounded-lg border border-gray-200 px-4 py-3">
            <BranchComparisonTable branches={branchRows} />
          </div>
        )}

        {/* Picos por hora — consolidado */}
        {consolidated && (
          <div className="rounded-lg border border-gray-200 px-4 py-3">
            <HourlyPeaksChart hourly={consolidated.hourly} />
          </div>
        )}

        {/* Desglose por canal — consolidado */}
        {consolidated && (
          <div className="rounded-lg border border-gray-200 px-4 py-3">
            <SourceBreakdown source={consolidated.source} total={consolidated.total} />
          </div>
        )}

        {/* No-show por dia de semana */}
        {consolidated && period !== 'day' && (
          <div className="rounded-lg border border-gray-200 px-4 py-3">
            <NoShowByDayChart noshowByDay={consolidated.noshow_by_day} period={period} />
          </div>
        )}

        {/* Top clientes consolidados */}
        {consolidated && consolidated.top_clients.length > 0 && (
          <div className="rounded-lg border border-gray-200 px-4 py-3">
            <p className="mb-2 text-xs font-medium text-gray-500">Top clientes</p>
            <TopClientsCard clients={consolidated.top_clients} />
          </div>
        )}

      </main>
    </div>
  );
}
