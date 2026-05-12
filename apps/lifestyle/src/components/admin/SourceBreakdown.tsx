// ─── SourceBreakdown ──────────────────────────────────────────────────────────
// 4 mini-cards con desglose de origen de las citas:
//   bot · walk-in · llamada · manual
//
// Muestra icono SVG inline + count + porcentaje relativo al total de citas.
// Sin librerías externas.

'use client';

import type { SourceBreakdownMetrics } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  source: SourceBreakdownMetrics;
  total: number;
};

// ─── Channel configs ──────────────────────────────────────────────────────────

type ChannelConfig = {
  key: keyof SourceBreakdownMetrics;
  label: string;
  icon: React.ReactNode;
  color: string;        // text color class
  bg: string;           // background class
};

const CHANNELS: ChannelConfig[] = [
  {
    key: 'bot',
    label: 'Bot',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M9 4a1 1 0 012 0v.111A6.003 6.003 0 0115.889 9H16a1 1 0 010 2h-.111A6.003 6.003 0 0111 15.889V16a1 1 0 01-2 0v-.111A6.003 6.003 0 014.111 11H4a1 1 0 010-2h.111A6.003 6.003 0 019 4.111V4zm1 2a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z" />
      </svg>
    ),
    color: 'text-violet-700',
    bg: 'bg-violet-50',
  },
  {
    key: 'walkin',
    label: 'Walk-in',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
      </svg>
    ),
    color: 'text-green-700',
    bg: 'bg-green-50',
  },
  {
    key: 'llamada',
    label: 'Llamada',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
      </svg>
    ),
    color: 'text-blue-700',
    bg: 'bg-blue-50',
  },
  {
    key: 'manual',
    label: 'Manual',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
      </svg>
    ),
    color: 'text-orange-700',
    bg: 'bg-orange-50',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function SourceBreakdown({ source, total }: Props) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-gray-500">Por canal</p>
      <div className="grid grid-cols-4 gap-1.5">
        {CHANNELS.map(({ key, label, icon, color, bg }) => {
          const count = source[key];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;

          return (
            <div
              key={key}
              className={`rounded-lg px-2 py-2 ${bg}`}
            >
              <div className={`${color}`}>{icon}</div>
              <p className={`mt-1 text-sm font-bold ${color}`}>{count}</p>
              <p className="text-[9px] text-gray-500">{label}</p>
              <p className="text-[9px] text-gray-400">{pct}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
