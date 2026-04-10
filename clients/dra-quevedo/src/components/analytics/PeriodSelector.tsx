'use client';

// ─── PeriodSelector ────────────────────────────────────────────────────────────
// Tres botones pill para seleccionar el período de analytics.
// Activo: fondo acento #C4916A, texto blanco.
// Inactivo: borde br2 #D8CEC4, texto t3, hover fondo surf.

import type { Period } from './types';

type PeriodSelectorProps = {
  readonly period: Period;
  readonly onChange: (p: Period) => void;
};

const OPTIONS: { value: Period; label: string }[] = [
  { value: 'hoy',    label: 'Hoy' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes',    label: 'Este mes' },
];

export function PeriodSelector({ period, onChange }: PeriodSelectorProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: '6px',
        backgroundColor: 'var(--an-surf)',
        borderRadius: '20px',
        padding: '3px',
      }}
    >
      {OPTIONS.map(({ value, label }) => {
        const isActive = value === period;
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            style={{
              padding: '5px 14px',
              borderRadius: '16px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: isActive ? 500 : 400,
              letterSpacing: '0.01em',
              backgroundColor: isActive ? 'var(--an-ac)' : 'transparent',
              color: isActive ? '#FFFFFF' : 'var(--an-t3)',
              transition: 'background-color 0.15s ease, color 0.15s ease',
              lineHeight: 1.4,
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--an-surf2)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              }
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
