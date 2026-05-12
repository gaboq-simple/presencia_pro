'use client';

// ─── BranchComparisonTable ────────────────────────────────────────────────────
// Tabla comparativa de sucursales para la vista consolidada.
//
// Muestra cada sucursal como fila con: citas totales, completadas, no-shows,
// tasa de no-show, e ingresos. Fila de totales al final.
//
// Interactividad:
//   - Ordenable por cualquier columna (click en el header).
//   - La sucursal con mayor ingreso tiene un badge sutil.
//   - Si la tasa de no-show > 15% → indicador rojo.
//   - Scroll horizontal en mobile.

import { useState, useMemo } from 'react';
import type { PeriodMetrics } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

export type BranchRow = {
  business_id: string;
  business_name: string;
  metrics: PeriodMetrics;
};

type Props = {
  branches: BranchRow[];
};

// ─── Tipos internos ───────────────────────────────────────────────────────────

type SortKey = 'name' | 'total' | 'completed' | 'no_show' | 'noshow_rate' | 'revenue';
type SortDir = 'asc' | 'desc';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function noShowRate(completed: number, noShow: number): number | null {
  const total = completed + noShow;
  if (total === 0) return null;
  return Math.round((noShow / total) * 100);
}

// ─── Subcomponente: header de columna ordenable ───────────────────────────────

function SortableHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = 'right',
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = currentKey === sortKey;
  return (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-800 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {align === 'left' && label}
        {active && (
          <span className="text-gray-400">{currentDir === 'asc' ? '↑' : '↓'}</span>
        )}
        {align === 'right' && label}
      </span>
    </th>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BranchComparisonTable({ branches }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  // Calcular tasa de no-show por fila
  const rows = useMemo(() => {
    return branches.map((b) => ({
      ...b,
      nsRate: noShowRate(b.metrics.completed, b.metrics.no_show),
    }));
  }, [branches]);

  // Ordenar
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'name':       diff = a.business_name.localeCompare(b.business_name); break;
        case 'total':      diff = a.metrics.total - b.metrics.total; break;
        case 'completed':  diff = a.metrics.completed - b.metrics.completed; break;
        case 'no_show':    diff = a.metrics.no_show - b.metrics.no_show; break;
        case 'noshow_rate':
          diff = (a.nsRate ?? -1) - (b.nsRate ?? -1);
          break;
        case 'revenue':    diff = a.metrics.revenue - b.metrics.revenue; break;
      }
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [rows, sortKey, sortDir]);

  // Sucursal con mayores ingresos
  const maxRevenue = Math.max(...branches.map((b) => b.metrics.revenue));

  // Totales
  const totals = useMemo(() => {
    const total     = branches.reduce((s, b) => s + b.metrics.total, 0);
    const completed = branches.reduce((s, b) => s + b.metrics.completed, 0);
    const no_show   = branches.reduce((s, b) => s + b.metrics.no_show, 0);
    const revenue   = branches.reduce((s, b) => s + b.metrics.revenue, 0);
    return { total, completed, no_show, revenue, nsRate: noShowRate(completed, no_show) };
  }, [branches]);

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-gray-500">Comparativa por sucursal</p>

      {/* Scroll horizontal en mobile */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <SortableHeader
                label="Sucursal"
                sortKey="name"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                align="left"
              />
              <SortableHeader
                label="Citas"
                sortKey="total"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                label="Completadas"
                sortKey="completed"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                label="No-shows"
                sortKey="no_show"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                label="Tasa NS"
                sortKey="noshow_rate"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortableHeader
                label="Ingresos"
                sortKey="revenue"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100 bg-white">
            {sorted.map((row) => {
              const isBest  = row.metrics.revenue > 0 && row.metrics.revenue === maxRevenue;
              const badNS   = row.nsRate !== null && row.nsRate > 15;

              return (
                <tr key={row.business_id} className="hover:bg-gray-50">
                  {/* Nombre */}
                  <td className="px-3 py-2.5 text-left">
                    <span className="font-medium text-gray-900 whitespace-nowrap">
                      {row.business_name}
                    </span>
                    {isBest && (
                      <span className="ml-1.5 inline-block rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-semibold text-green-700">
                        top
                      </span>
                    )}
                  </td>

                  {/* Citas totales */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                    {row.metrics.total}
                  </td>

                  {/* Completadas */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-green-700">
                    {row.metrics.completed}
                  </td>

                  {/* No-shows */}
                  <td className="px-3 py-2.5 text-right tabular-nums text-red-600">
                    {row.metrics.no_show}
                  </td>

                  {/* Tasa NS */}
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {row.nsRate !== null ? (
                      <span
                        className={`font-semibold ${
                          badNS ? 'text-red-600' : 'text-gray-500'
                        }`}
                      >
                        {row.nsRate}%
                        {badNS && (
                          <span className="ml-0.5 text-red-500" aria-label="alto no-show">
                            ●
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>

                  {/* Ingresos */}
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap">
                    {formatCurrency(row.metrics.revenue)}
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Fila de totales */}
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr>
              <td className="px-3 py-2 text-left text-xs font-bold text-gray-700">Total</td>
              <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-gray-800">
                {totals.total}
              </td>
              <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-green-700">
                {totals.completed}
              </td>
              <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-red-600">
                {totals.no_show}
              </td>
              <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-gray-600">
                {totals.nsRate !== null ? `${totals.nsRate}%` : '—'}
              </td>
              <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-gray-900 whitespace-nowrap">
                {formatCurrency(totals.revenue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
