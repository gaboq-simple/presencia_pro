// ─── StaffMetricsPanel ────────────────────────────────────────────────────────
// Client Component — métricas por barbero para el dashboard admin.
//
// Responsabilidades:
//   - Selector semana/mes — default semana actual.
//   - Fetch a /api/reports/staff-metrics con revalidación cada 300s.
//   - Por cada barbero: tarjeta con foto/iniciales, ingresos, citas y
//     barra de clientes nuevos vs recurrentes (CSS puro, sin chart library).
//   - Ordenado por ingresos DESC (el servidor ya lo hace).
//   - Fade-in al cargar.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import type { StaffMetrics, StaffMetricsPeriod } from '@/lib/dashboard.types';

// ─── Config ───────────────────────────────────────────────────────────────────

const REVALIDATE_MS = 300_000;

const PERIOD_LABELS: Record<StaffMetricsPeriod, string> = {
  week:  'Semana',
  month: 'Mes',
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  date: string;        // 'YYYY-MM-DD' — día ancla del dashboard
  businessId: string;  // business_id de la sucursal activa
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

// ─── Subcomponente: barra nuevos vs recurrentes ───────────────────────────────

function ClientBar({
  newClients,
  recurring,
}: {
  newClients: number;
  recurring: number;
}) {
  const total = newClients + recurring;
  if (total === 0) {
    return (
      <div className="mt-2">
        <div className="h-1.5 w-full rounded-full bg-gray-100" />
        <p className="mt-1 text-xs text-gray-400">Sin clientes en el período</p>
      </div>
    );
  }

  const recurringPct = Math.round((recurring / total) * 100);
  const newPct = 100 - recurringPct;

  return (
    <div className="mt-2">
      {/* Barra */}
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        {recurring > 0 && (
          <div
            className="h-full bg-gray-800"
            style={{ width: `${recurringPct}%` }}
            title={`Recurrentes: ${recurring}`}
          />
        )}
        {newClients > 0 && (
          <div
            className="h-full bg-gray-300"
            style={{ width: `${newPct}%` }}
            title={`Nuevos: ${newClients}`}
          />
        )}
      </div>
      {/* Leyenda */}
      <div className="mt-1 flex items-center gap-3">
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <span className="inline-block h-2 w-2 rounded-sm bg-gray-800" />
          {recurring} recurrentes
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block h-2 w-2 rounded-sm bg-gray-300" />
          {newClients} nuevos
        </span>
      </div>
    </div>
  );
}

// ─── Helper: tasa de no-show ──────────────────────────────────────────────────

function noShowRate(completed: number, noShow: number): number | null {
  const total = completed + noShow;
  if (total === 0) return null;
  return Math.round((noShow / total) * 100);
}

function noShowBadgeClass(rate: number): string {
  if (rate > 20) return 'bg-red-100 text-red-700';
  if (rate < 5)  return 'bg-green-100 text-green-700';
  return 'bg-gray-100 text-gray-500';
}

// ─── Subcomponente: tarjeta individual de barbero ─────────────────────────────

function StaffCard({
  staff,
  rank,
  revenuePct,
}: {
  staff: StaffMetrics;
  rank: number;
  revenuePct: number | null;
}) {
  const rate = noShowRate(staff.appointments_completed, staff.appointments_no_show);

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-4">
      {/* Cabecera: ranking + avatar + nombre + ingresos */}
      <div className="flex items-center gap-3">
        {/* Número de ranking */}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
          {rank}
        </span>

        {/* Avatar */}
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-100">
          {staff.photo_url ? (
            <Image
              src={staff.photo_url}
              alt={staff.staff_name}
              fill
              className="object-cover"
              sizes="40px"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-500">
              {getInitials(staff.staff_name)}
            </span>
          )}
        </div>

        {/* Nombre + badge no-show + ingresos + % del total */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-gray-900">
              {staff.staff_name}
            </p>
            {rate !== null && (
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${noShowBadgeClass(rate)}`}>
                {rate}% no-show
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1.5">
            <p className="text-xl font-bold text-gray-900">
              {formatCurrency(staff.total_revenue)}
            </p>
            {revenuePct !== null && (
              <span className="text-xs text-gray-400">({revenuePct}%)</span>
            )}
          </div>
        </div>
      </div>

      {/* Contadores de citas */}
      <div className="mt-3 flex gap-2">
        <StatPill
          value={staff.appointments_completed}
          label="completadas"
          color="text-green-700"
          bg="bg-green-50"
        />
        <StatPill
          value={staff.appointments_no_show}
          label="no asistió"
          color="text-red-600"
          bg="bg-red-50"
        />
        <StatPill
          value={staff.appointments_cancelled}
          label="canceladas"
          color="text-gray-500"
          bg="bg-gray-50"
        />
      </div>

      {/* Barra nuevos vs recurrentes */}
      <ClientBar newClients={staff.new_clients} recurring={staff.recurring_clients} />
    </div>
  );
}

function StatPill({
  value,
  label,
  color,
  bg,
}: {
  value: number;
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={`flex-1 rounded px-2 py-1.5 ${bg}`}>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

// ─── Component principal ──────────────────────────────────────────────────────

export default function StaffMetricsPanel({ date, businessId }: Props) {
  const [period, setPeriod] = useState<StaffMetricsPeriod>('week');
  const [metrics, setMetrics] = useState<StaffMetrics[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async (p: StaffMetricsPeriod, d: string) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ period: p, date: d });
      if (businessId) params.set('business_id', businessId);
      const res = await fetch(
        `/api/reports/staff-metrics?${params.toString()}`,
        { credentials: 'same-origin' },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as StaffMetrics[];
      setMetrics(data);
      // Fade-in al recibir datos por primera vez
      setVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar métricas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMetrics(period, date);

    intervalRef.current = setInterval(() => {
      void fetchMetrics(period, date);
    }, REVALIDATE_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [period, date, fetchMetrics]);

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500">Rendimiento del equipo</p>
        <div className="flex gap-1">
          {(['week', 'month'] as StaffMetricsPeriod[]).map((p) => (
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

        {metrics && metrics.length === 0 && (
          <p className="text-xs text-gray-400">Sin citas en este período</p>
        )}

        {metrics && metrics.length > 0 && (
          <div
            className={`space-y-3 transition-opacity duration-300 ${
              visible ? 'opacity-100' : 'opacity-0'
            } ${loading ? 'opacity-50' : ''}`}
          >
            {(() => {
              const totalRevenue = metrics.reduce((s, m) => s + m.total_revenue, 0);
              return metrics.map((staff, idx) => (
                <StaffCard
                  key={staff.staff_id}
                  staff={staff}
                  rank={idx + 1}
                  revenuePct={
                    totalRevenue > 0
                      ? Math.round((staff.total_revenue / totalRevenue) * 100)
                      : null
                  }
                />
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
