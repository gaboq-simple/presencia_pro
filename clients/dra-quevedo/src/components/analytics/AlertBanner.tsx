'use client';

// ─── AlertBanner ───────────────────────────────────────────────────────────────
// Card de alerta dinámica con línea top de 2px coloreada según tipo.
// warn → rojo, ok → verde, info → ámbar.
// Nunca usa fondos de color agresivo ni franjas laterales sólidas.

import type { AlertType } from './types';

export type AlertBannerProps = {
  readonly type: AlertType;
  readonly title: string;
  readonly subtitle: string;
  readonly chip: string;
};

const STYLES: Record<
  AlertType,
  {
    topColor: string;
    borderColor: string;
    iconBg: string;
    iconColor: string;
    symbol: string;
    chipBg: string;
    chipBorder: string;
    chipText: string;
  }
> = {
  warn: {
    topColor:    'var(--an-red)',
    borderColor: '#E8C8C4',
    iconBg:      'var(--an-redL)',
    iconColor:   'var(--an-redD)',
    symbol:      '!',
    chipBg:      'var(--an-redL)',
    chipBorder:  '#E8C8C4',
    chipText:    'var(--an-redD)',
  },
  ok: {
    topColor:    'var(--an-grn)',
    borderColor: '#C8DEB8',
    iconBg:      'var(--an-grnL)',
    iconColor:   'var(--an-grnD)',
    symbol:      '✓',
    chipBg:      'var(--an-grnL)',
    chipBorder:  '#C8DEB8',
    chipText:    'var(--an-grnD)',
  },
  info: {
    topColor:    'var(--an-amb)',
    borderColor: '#E0CCA0',
    iconBg:      'var(--an-ambL)',
    iconColor:   'var(--an-ambD)',
    symbol:      'i',
    chipBg:      'var(--an-ambL)',
    chipBorder:  '#E0CCA0',
    chipText:    'var(--an-ambD)',
  },
};

export function AlertBanner({ type, title, subtitle, chip }: AlertBannerProps) {
  const s = STYLES[type];

  return (
    <div
      style={{
        backgroundColor: 'var(--an-card)',
        borderRadius: '10px',
        border: `.5px solid ${s.borderColor}`,
        overflow: 'hidden',
      }}
    >
      {/* Línea top coloreada */}
      <div
        style={{
          height: '2px',
          backgroundColor: s.topColor,
          borderRadius: '10px 10px 0 0',
        }}
      />

      {/* Contenido */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '12px 14px',
        }}
      >
        {/* Ícono en círculo */}
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: s.iconBg,
            color: s.iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '13px',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {s.symbol}
        </div>

        {/* Textos */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 500,
              color: 'var(--an-t1)',
              letterSpacing: '-0.01em',
              lineHeight: 1.3,
            }}
          >
            {title}
          </p>
          <p
            style={{
              margin: '3px 0 0',
              fontSize: '12px',
              color: 'var(--an-t2)',
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        </div>

        {/* Chip */}
        <span
          style={{
            flexShrink: 0,
            padding: '3px 8px',
            borderRadius: '10px',
            border: `.5px solid ${s.chipBorder}`,
            backgroundColor: s.chipBg,
            color: s.chipText,
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          {chip}
        </span>
      </div>
    </div>
  );
}
