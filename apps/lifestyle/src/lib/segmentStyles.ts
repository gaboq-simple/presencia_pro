// ─── Mapa ÚNICO segmento → {label, color} ─────────────────────────────────────
// Fuente compartida para los consumidores que etiquetan/pintan POR SEGMENTO RFM:
// la grilla de grupos de Clientela y el bloque de movimiento (PR-C). Tokens
// Zentriq-claro (globals.css @theme): teal=bueno, ámbar=atención, gris=perdido/neutro.
//
// 🔴 NO incluye a HoyFeed (`URGENCY`) ni al accent de retención: son OTROS ejes
//    (urgencia de rescate / binario), con labels y colores propios a propósito.

import type { RfmSegment } from './cadence';

export type SegmentStyle = {
  label: string;
  /** border-left del card (grupos). */ card: string;
  /** color del número (grupos). */      count: string;
  /** pill de fondo/borde. */            pill: string;
};

export const SEGMENT_STYLE: Record<RfmSegment, SegmentStyle> = {
  campeones:      { label: 'Campeones',      card: 'border-l-4 border-l-teal-border',  count: 'text-teal-ink', pill: 'bg-tint-1 text-teal-ink border border-teal-border' },
  regulares:      { label: 'Regulares',      card: 'border-l-4 border-l-line-2',       count: 'text-ink',      pill: 'bg-card text-ink-2 border border-line-2' },
  nuevos:         { label: 'Nuevos',         card: 'border-l-4 border-l-line-2',        count: 'text-ink',      pill: 'bg-card text-ink-2 border border-line-2' },
  se_estan_yendo: { label: 'Se están yendo', card: 'border-l-4 border-l-amber-border',  count: 'text-amber',    pill: 'bg-amber-tint text-amber border border-amber-border' },
  perdidos:       { label: 'Perdidos',       card: 'border-l-4 border-l-past-line',     count: 'text-past-ink', pill: 'bg-past-bg text-past-ink border border-past-line' },
};

/** Orden de presentación de los grupos en Clientela. */
export const SEGMENT_ORDER: RfmSegment[] = ['campeones', 'regulares', 'nuevos', 'se_estan_yendo', 'perdidos'];
