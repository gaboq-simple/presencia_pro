// ─── AssistantVerticalCalendar ─────────────────────────────────────────────────
// Calendario VERTICAL de día completo de la mesa de control del asistente.
//
// Reemplaza el panorama horizontal de 3h (PanoramaTimeline) por un calendario de
// día completo: barberos en COLUMNAS, tiempo en el eje Y con scroll vertical natural.
// Al montar hace auto-scroll para dejar "ahora" visible (arranca en el presente,
// pero sin limitar a 3h — el asistente puede scrollear a todo el día).
//
// Se pliega al contenedor (AssistantControlDesk): recibe la MISMA data que hoy
// recibe PanoramaTimeline (appointments, staff=PanoramaStaff, staffBlocks, date,
// timezone) y el callback de creación onTapFreeSlot(staffId, startMin).
//
// ALCANCE (Paso 1): geometría vertical + tokens Zentriq + auto-scroll + línea-ahora
// + click-en-hueco.
// ALCANCE (Paso 2A): estados finos del bloque con paridad al panorama + cierre del
// gap pending≠confirmed (ámbar): conf/pending/curso/late/done/noshow/walk por
// color/tono (nunca opacity); curso/late derivados del "ahora" TZ-aware; pulso
// animate-data-beat en late. Info completa (nombre + servicio + hora) con degradación
// por alto en bloques cortos. Badge de source solo para bot.
// ALCANCE (Paso 3A): card de detalle VISUAL al click-en-cita (anclada al bloque, velo
// claro sutil, ring/border por estado, acciones por estado+momento con ventana
// anticipada de 10min — SIN mutar datos, el cableado es Paso 3B) + banda sutil del
// "ahora" (franja tenue + hairline + pastilla de hora en el gutter).
// ALCANCE (Paso 3.5): pulido visual de la card al mock congelado (.fcard): ancho 360,
//   animación de entrada, border-left del estado en la cabecera, badge con puntito,
//   nombre 20px, sub "servicio · con barbero", filas con ícono+etiqueta 70px+valor,
//   zona de acciones con degradado, y botones circulares 46px con glow (elevación +
//   halo de color al hover). Fix del nombre "III" (customer con name vacío). Puro visual.
// ALCANCE (Paso 3B): acciones de la card cableadas a server actions vía callbacks del
//   desk (optimista+toast): No-llegó/Terminó/Confirmar/Llegó/Cancelar(+motivo);
//   Mensaje=wa.me, Llamar=tel: (sin mutar). Mover/Reagendar quedan visuales (gesto=4).
//   confirmAppointment y markArrived (arrived_at, guard de auto-cancel) son nuevas.
// ALCANCE (Paso 4A): feedback de hora al hover sobre un hueco libre (mismo cálculo
//   `slotFromRelY` que el click). Solo en zona reservable. No cambia la creación.
// ALCANCE (Paso 4A.2): reestilo sereno del feedback (quitar el "andamio"): wash suave
//   con forma de cita-fantasma (tint-1 + acento teal, sin borde punteado ni pastilla),
//   alto = duración por defecto del walk-in acotada al hueco real; la hora se integra
//   en el gutter (pastilla teal en la regla de tiempo). Solo estilo, el cálculo igual.
// PENDIENTE de pasos siguientes: drag / click-to-place / walk-in de un toque + Mover/
//   Reagendar (4B+), foco de barbero, descansos (break_start/end), retiro de
//   PanoramaTimeline. Los callbacks de gesto (onPlace/reschedule) siguen inertes.
//
// NOTA: los helpers de tiempo son un espejo de PanoramaTimeline/AvailabilityTimeline
// (module-local, no exportados). Extraerlos a un util compartido es de un paso posterior.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import type {
  PanoramaStaff,
  PanoramaBlock,
  MoveState,
  WalkinRequest,
  RescheduleRequest,
  PlaceOpts,
} from './PanoramaTimeline';

// ─── Props ────────────────────────────────────────────────────────────────────
// Mismo contrato de data que PanoramaTimeline (el desk lo monta con las mismas
// props). Los callbacks de gesto que el vertical aún NO implementa se aceptan como
// opcionales e inertes (Paso 1) para no romper el montaje detrás del flag.

type Props = {
  date: string;                 // 'YYYY-MM-DD' del día mostrado
  timezone: string;             // IANA — p.ej. 'America/Mexico_City'
  appointments: DashboardAppointment[];
  staff: PanoramaStaff[];       // barberos (columnas), en orden
  staffBlocks: PanoramaBlock[]; // bloqueos aprobados del día
  // Click-en-hueco → crear cita: el desk abre la hoja de walk-in pre-apuntada.
  onTapFreeSlot?: (staffId: string, startMin: number) => void;
  // Duración por defecto del walk-in (min) — para dimensionar el wash del feedback al
  // tamaño real que tendría la cita. El desk usa services[0].duration_minutes ?? 30.
  walkinDefaultMin?: number;
  // ── Acciones de la card de detalle (Paso 3B). El desk hace el optimista+toast. ──
  onNoShow?: (id: string) => void;
  onComplete?: (id: string) => void;
  onConfirm?: (id: string) => void;
  onArrived?: (id: string) => void;
  onCancel?: (id: string, reason: string) => void;
  // ── Inertes en Paso 1 (drag / click-to-place / walk-in de un toque = pasos sig.) ──
  onPlace?: (move: MoveState, newStaffId: string, newStartMin: number, opts?: PlaceOpts) => void;
  walkinRequest?: WalkinRequest | null;
  onWalkinConsumed?: () => void;
  rescheduleRequest?: RescheduleRequest | null;
  onRescheduleConsumed?: () => void;
  highlightApptId?: string | null;
  onInteractingChange?: (active: boolean) => void;
};

// ─── Config visual ────────────────────────────────────────────────────────────

const HOUR_HEIGHT_PX   = 60;   // alto de cada hora en px
const COL_MIN_WIDTH_PX = 200;  // ancho mínimo cómodo por barbero antes de scroll-X
const TIME_COL_WIDTH_PX = 52;  // ancho de la columna de horas (sticky izquierda)
const HEADER_HEIGHT_PX = 40;   // alto de la cabecera de nombres (sticky arriba)
const FALLBACK_START = 9;      // hora de apertura default si no hay datos
const FALLBACK_END   = 20;     // hora de cierre default si no hay datos

const PX_PER_MIN = HOUR_HEIGHT_PX / 60; // 60px/h = 1px/min

// ── Drag para mover (Paso 4D) ──
const DRAG_THRESHOLD_PX = 5;   // mover más que esto con el botón abajo → es drag (no click)
const EDGE_ZONE_PX      = 44;  // px desde el borde sup/inf del scroll que dispara auto-scroll
const AUTO_SCROLL_PX    = 12;  // px por frame del auto-scroll en el borde

// Tono Zentriq por estado (Paso 1: base + mínimo para no regresar). El set fino de
// 6 estados (curso/late/pending distinguidos) es del Paso 2. Espejo del STATE_STYLE
// de PanoramaTimeline, sin los estados derivados del tiempo.
// Estado visual del bloque — paridad con el STATE_STYLE del panorama (mismos tokens)
// + `pending` (ámbar) para cerrar el gap "pending ≠ confirmed" que el panorama no
// distinguía. Diferenciación por color/tono (border-left + fondo + tinta), NUNCA por
// opacity. `curso`/`late` son derivados del "ahora" TZ-aware (no del campo status).
type BlockState = 'conf' | 'pending' | 'curso' | 'late' | 'done' | 'noshow' | 'walk';
const STATE_STYLE: Record<BlockState, { bar: string; bg: string; ink: string }> = {
  conf:    { bar: 'var(--color-ink-2)',       bg: 'bg-card',      ink: 'text-ink' },
  pending: { bar: 'var(--color-amber-border)', bg: 'bg-amber-tint', ink: 'text-amber' },
  curso:   { bar: 'var(--color-teal-border)', bg: 'bg-tint-1',    ink: 'text-teal-ink' },
  late:    { bar: 'var(--color-red-border)',  bg: 'bg-red-tint',  ink: 'text-red-ink' },
  done:    { bar: 'var(--color-past-line)',   bg: 'bg-past-bg',   ink: 'text-past-ink' },
  noshow:  { bar: 'var(--color-red-border)',  bg: 'bg-red-tint',  ink: 'text-red-ink' },
  walk:    { bar: 'var(--color-walk-border)', bg: 'bg-walk-tint', ink: 'text-walk' },
};

// Palabra de estado en la meta-línea (paridad con el panorama: solo para los estados
// que ganan claridad con texto; el resto se lee por color).
const STATE_WORD: Partial<Record<BlockState, string>> = {
  curso: 'En curso', late: 'Atrasado', noshow: 'No llegó', pending: 'Por confirmar',
};

// Clase de glow al hover por estado (Paso 4C) — la definición vive en globals.css
// (`.appt-glow-*`, CSS plano; Tailwind v4 no genera box-shadow con rgba inline). Mapea
// cada estado a su color: conf/curso→teal, pending→amber, walk→violet, done→apagado,
// noshow/late→rojo. Se combina con `.appt-hover` (elevación + z-index).
const GLOW_CLASS: Record<BlockState, string> = {
  conf: 'appt-glow-teal', curso: 'appt-glow-teal', pending: 'appt-glow-amber',
  walk: 'appt-glow-walk', done: 'appt-glow-done', noshow: 'appt-glow-red', late: 'appt-glow-red',
};

/**
 * Estado del bloque combinando status + momento (mismo criterio que PanoramaTimeline
 * :298-305, con `pending` insertado). `startM`/`endM` = min-desde-medianoche (tz negocio).
 * nowM = null cuando el día mostrado no es hoy → sin curso/late (no hay "ahora").
 */
function stateFor(
  a: DashboardAppointment, startM: number, endM: number, nowM: number | null,
): BlockState {
  if (a.status === 'completed') return 'done';
  if (a.status === 'no_show') return 'noshow';
  if (a.status === 'walkin' || a.source === 'walkin') return 'walk';
  if (nowM !== null && startM <= nowM && nowM < endM) return 'curso';
  if (nowM !== null && nowM >= endM) return 'late'; // ventana pasó, sin cerrar
  if (a.status === 'pending') return 'pending';
  return 'conf';
}

// ─── Helpers de tiempo (espejo de PanoramaTimeline/AvailabilityTimeline) ──────

/** 'HH:MM[:SS]' → minutos desde medianoche */
function timeToMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/** ISO → minutos desde medianoche en el timezone dado */
function isoToLocalMinutes(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(iso));
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return (h === 24 ? 0 : h) * 60 + m;
}

/** Hora actual en minutos desde medianoche según el timezone del negocio */
function nowLocalMinutes(timezone: string): number {
  return isoToLocalMinutes(new Date().toISOString(), timezone);
}

/** minutos desde medianoche → 'HH:MM' 24h */
function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** ¿la fecha dada es hoy según el timezone? */
function isToday(date: string, timezone: string): boolean {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()) === date;
}

/** iniciales para el avatar del barbero */
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·';
}

// ─── Card de detalle (Paso 3A — VISUAL, sin mutar datos) ──────────────────────

// Etiqueta completa del estado para el badge de la card.
const STATE_LABEL: Record<BlockState, string> = {
  conf: 'Confirmada', pending: 'Por confirmar', curso: 'En curso',
  late: 'Atrasada', done: 'Terminada', noshow: 'No llegó', walk: 'Walk-in',
};
// Ring sutil de la card según estado (teal para confirmada/curso, ámbar pending,
// rojo late/noshow, walk, neutro done). El border-left usa el color del bloque.
const CARD_RING: Record<BlockState, string> = {
  conf: 'ring-teal-border', curso: 'ring-teal-border', pending: 'ring-amber-border',
  late: 'ring-red-border', noshow: 'ring-red-border', walk: 'ring-walk-border',
  done: 'ring-past-line',
};

type ActionKey =
  | 'mensaje' | 'mover' | 'cancelar' | 'confirmar'
  | 'llego' | 'noLlego' | 'termino' | 'reagendar' | 'llamar';

type ActionAccent = 'pos' | 'warn' | 'danger' | 'neutral';
const ACTION: Record<ActionKey, { label: string; accent: ActionAccent }> = {
  mensaje:   { label: 'Mensaje',   accent: 'neutral' },
  mover:     { label: 'Mover',     accent: 'neutral' },
  cancelar:  { label: 'Cancelar',  accent: 'danger' },
  confirmar: { label: 'Confirmar', accent: 'pos' },
  llego:     { label: 'Llegó',     accent: 'pos' },
  noLlego:   { label: 'No llegó',  accent: 'warn' },
  termino:   { label: 'Terminó',   accent: 'pos' },
  reagendar: { label: 'Reagendar', accent: 'neutral' },
  llamar:    { label: 'Llamar',    accent: 'pos' },
};
// Acabado "glow" del botón circular (mock .actbtn/.circ): al hover el círculo se eleva
// (-translateY) y aparece un halo de color según la acción (0 0 0 4px wash + sombra de
// color). El ícono lleva el color de acento en reposo. Washes mapeados a tokens Zentriq:
// teal-wash→tint-1, amber-wash→amber-tint (exacto), danger-wash→red-tint, neutral→line-2.
const ACCENT_CLS: Record<ActionAccent, string> = {
  pos:     'text-teal-ink card-glow-pos',
  warn:    'text-amber card-glow-warn',
  danger:  'text-red-ink card-glow-danger',
  neutral: 'text-ink-2 card-glow-neutral',
};

// Íconos de fila (18px, faint) — clock / phone / note.
function RowIcon({ k }: { k: 'clock' | 'phone' | 'note' }) {
  const p = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (k === 'clock') return <svg {...p} aria-hidden><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 1.5" /></svg>;
  if (k === 'phone') return <svg {...p} aria-hidden><path d="M4.5 3.5c0 7.5 4.5 12 12 12l-.2-3-3-1-1.8 1.8c-1.8-1-3.8-3-4.8-4.8L8.5 7.7l-1-3H4.5z" /></svg>;
  return <svg {...p} aria-hidden><path d="M5 3.5h7l3 3v10H5zM12 3.5V6.5h3M7.5 10h5M7.5 13h5" /></svg>;
}

/**
 * Set de acciones según estado + momento (visual; el cableado a server actions es
 * Paso 3B). Ventana anticipada: Llegó/No-llegó desde inicio − 10min ≤ ahora.
 */
function actionsFor(state: BlockState, apptStart: number, nowM: number | null): ActionKey[] {
  if (state === 'done')    return ['reagendar', 'mensaje', 'llamar'];
  if (state === 'noshow')  return ['reagendar', 'mensaje', 'llamar'];
  if (state === 'walk')    return ['termino', 'mensaje', 'mover', 'cancelar'];
  if (state === 'pending') return ['confirmar', 'mensaje', 'mover', 'cancelar'];
  // conf / curso / late — ventana anticipada de 10 min activa Llegó/No-llegó.
  const inWindow = nowM !== null && nowM >= apptStart - 10;
  if (inWindow) return ['llego', 'noLlego', 'mensaje', 'cancelar'];
  return ['mensaje', 'mover', 'cancelar'];
}

/** Íconos minimalistas por acción (SVG stroke, currentColor). */
function ActionIcon({ k }: { k: ActionKey }) {
  const p = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  switch (k) {
    case 'mensaje':   return <svg {...p} aria-hidden><path d="M3 4.5h14v9H8l-4 3v-3H3z" /></svg>;
    case 'mover':     return <svg {...p} aria-hidden><path d="M10 3v14M6 7l4-4 4 4M6 13l4 4 4-4" /></svg>;
    case 'cancelar':  return <svg {...p} aria-hidden><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>;
    case 'confirmar': return <svg {...p} aria-hidden><path d="M4 10.5l3.5 3.5L16 6" /></svg>;
    case 'llego':     return <svg {...p} aria-hidden><circle cx="8" cy="6.5" r="3" /><path d="M3 16c0-2.8 2.3-4.5 5-4.5.7 0 1.4.1 2 .3M12.5 14.5l2 2 3.5-4" /></svg>;
    case 'noLlego':   return <svg {...p} aria-hidden><circle cx="8" cy="6.5" r="3" /><path d="M3 16c0-2.8 2.3-4.5 5-4.5M13 13l4 4M17 13l-4 4" /></svg>;
    case 'termino':   return <svg {...p} aria-hidden><circle cx="10" cy="10" r="7" /><path d="M6.5 10l2.5 2.5 5-5" /></svg>;
    case 'reagendar': return <svg {...p} aria-hidden><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" /></svg>;
    case 'llamar':    return <svg {...p} aria-hidden><path d="M4.5 3.5c0 7.5 4.5 12 12 12l-.2-3-3-1-1.8 1.8c-1.8-1-3.8-3-4.8-4.8L8.5 7.7l-1-3H4.5z" /></svg>;
  }
}

const CARD_W = 360;
const CARD_H_EST = 340;

type Selection = { appt: DashboardAppointment; state: BlockState; rect: DOMRect };

// ─── Modo colocación (Paso 4B — gesto click-to-place para Mover/Reagendar) ────
// La cita "levantada" que sigue al cursor. `staffId`/`staffName` = barbero ORIGINAL
// (para marcar el bloque en movimiento y detectar cambio de columna). `dur` dimensiona
// el wash al tamaño real de ESTA cita (no el default del walk-in). `startMin` es su
// hora original (referencia). El destino se resuelve al hover; se congela al confirmar.
type Placing = {
  apptId: string; staffId: string; staffName: string;
  dur: number; name: string; service: string; startMin: number;
};
// Destino elegido, en espera de confirmación ("¿Mover a las HH:MM?"). El wash queda
// congelado acá hasta Confirmar/Cancelar (mover MUTA datos → siempre confirma).
type PlaceConfirm = { staffId: string; staffName: string; min: number };

function DetailCard({
  sel, timezone, nowMinutes, onClose,
  onNoShow, onComplete, onConfirm, onArrived, onCancel, onMove,
}: {
  sel: Selection; timezone: string; nowMinutes: number | null; onClose: () => void;
  onNoShow?: (id: string) => void;
  onComplete?: (id: string) => void;
  onConfirm?: (id: string) => void;
  onArrived?: (id: string) => void;
  onCancel?: (id: string, reason: string) => void;
  onMove?: (appt: DashboardAppointment) => void; // Paso 4B: entra al gesto click-to-place
}) {
  const { appt, state, rect } = sel;
  const st = STATE_STYLE[state];
  const apptStart = isoToLocalMinutes(appt.starts_at, timezone);
  const apptEnd   = isoToLocalMinutes(appt.ends_at,   timezone);
  const isWalk = appt.status === 'walkin' || appt.source === 'walkin';
  // `||` (no `??`) para tratar nombre vacío/espacios como ausente (fix del "III":
  // customer con name '' caía en `'' ?? …` y renderizaba vacío/basura).
  const custName = appt.customer?.name?.trim();
  const name = custName || (isWalk ? 'Walk-in (sin nombre)' : 'Sin cliente');
  const dur = Math.max(0, apptEnd - apptStart);
  const actions = actionsFor(state, apptStart, nowMinutes);

  // Cancelar captura un motivo (se escribe a notes en cancelAppointment).
  const [cancelMode, setCancelMode] = useState(false);
  const [reason, setReason] = useState('');
  // Links sin mutación: Mensaje = WhatsApp (wa.me), Llamar = tel:.
  const phoneRaw = appt.customer?.phone ?? '';
  const waHref = phoneRaw ? `https://wa.me/${phoneRaw.replace(/\D/g, '')}` : undefined;
  const telHref = phoneRaw ? `tel:${phoneRaw}` : undefined;

  // Despacha una acción mutante y cierra la card (el desk hace optimista+toast).
  function run(k: ActionKey) {
    switch (k) {
      case 'noLlego':   onNoShow?.(appt.id);  onClose(); break;
      case 'termino':   onComplete?.(appt.id); onClose(); break;
      case 'confirmar': onConfirm?.(appt.id);  onClose(); break;
      case 'llego':     onArrived?.(appt.id);  onClose(); break;
      case 'cancelar':  setCancelMode(true); break; // pide motivo antes de mutar
      case 'mover': case 'reagendar':
        // Paso 4B: la card se cierra y entra el modo colocación para ESTA cita.
        onMove?.(appt); break;
      default: break; // mensaje/llamar se renderizan como <a>
    }
  }

  // Contenido visual del botón (círculo 46px + label), compartido por <button> y <a>.
  // Reposo: borde line + sombra sutil. Hover: elevación + halo de color (ACCENT_CLS).
  const chip = (k: ActionKey) => (
    <>
      <span className={`card-actbtn grid h-[46px] w-[46px] place-items-center rounded-pill border border-line bg-card transition duration-150 active:scale-95 ${ACCENT_CLS[ACTION[k].accent]}`}>
        <ActionIcon k={k} />
      </span>
      <span className="text-[11px] font-medium text-ink-2">{ACTION[k].label}</span>
    </>
  );

  // Ancla espacial: al lado del bloque. Por defecto a la derecha; si sabemos el ancho
  // del viewport y no cabe, se voltea a la izquierda. El clamp final a los bordes se
  // hace en CSS con clamp()+vw/dvh (unidades reales aunque innerWidth JS sea 0 en
  // algunos entornos headless), así la card nunca se sale de pantalla.
  const gap = 10;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0; // 0 = desconocido
  let rawLeft = rect.right + gap;
  if (vw > 0 && rawLeft + CARD_W > vw - 8) rawLeft = rect.left - CARD_W - gap;
  const rawTop = rect.top;
  const leftCss = `clamp(8px, ${Math.round(rawLeft)}px, calc(100vw - ${CARD_W + 8}px))`;
  const topCss = `clamp(8px, ${Math.round(rawTop)}px, calc(100dvh - ${CARD_H_EST + 8}px))`;

  const fmt = (m: number) => minutesToLabel(m);

  // Filas de detalle (ícono + etiqueta 70px + valor). Barbero va en el subtítulo.
  const rows: Array<{ icon: 'clock' | 'phone' | 'note'; label: string; value: string; mono?: boolean }> = [
    { icon: 'clock', label: 'Horario', value: `${fmt(apptStart)}–${fmt(apptEnd)} · ${dur} min`, mono: true },
  ];
  if (appt.customer?.phone) rows.push({ icon: 'phone', label: 'Teléfono', value: appt.customer.phone, mono: true });
  if (appt.notes) rows.push({ icon: 'note', label: 'Nota', value: appt.notes });

  return (
    <div
      role="dialog"
      aria-label={`Detalle de cita de ${name}`}
      className={`fixed z-50 animate-card-in overflow-hidden rounded-card border border-line bg-card shadow-hero ring-1 motion-reduce:animate-none ${CARD_RING[state]}`}
      style={{ left: leftCss, top: topCss, width: CARD_W, maxHeight: 'calc(100dvh - 24px)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Cabecera — border-left del color del estado (identidad), badge, nombre, sub */}
      <div className="relative pb-[14px] pl-5 pr-5 pt-[18px]" style={{ borderLeft: `4px solid ${st.bar}` }}>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-pill text-ink-2 transition hover:bg-canvas active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-ink"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
            <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
          </svg>
        </button>
        <span className={`mb-[9px] inline-flex items-center gap-1.5 rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.04em] ${st.bg} ${st.ink}`}>
          <span className="h-1.5 w-1.5 rounded-pill" style={{ background: st.bar }} aria-hidden />
          {STATE_LABEL[state]}
        </span>
        <p className="truncate text-[20px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">{name}</p>
        <p className="mt-[3px] truncate text-[13px] text-ink-2">{appt.service.name} · con {appt.staff.name}</p>
      </div>

      {/* Filas de detalle */}
      <div className="pb-[14px] pl-5 pr-5 pt-[2px]">
        {rows.map((r, i) => (
          <div
            key={r.label}
            className={`flex items-center gap-2.5 py-[9px] text-[13.5px] ${i < rows.length - 1 ? 'border-b border-line' : ''}`}
          >
            <span className="shrink-0 text-faint"><RowIcon k={r.icon} /></span>
            <span className="w-[70px] shrink-0 text-[12.5px] text-faint">{r.label}</span>
            <span className={`min-w-0 flex-1 truncate font-medium text-ink ${r.mono ? 'tabular-nums' : ''}`}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* Acciones — cableadas (Paso 3B). Mensaje/Llamar = links (sin mutar);
          Confirmar/Llegó/No-llegó/Terminó/Cancelar mutan vía el desk; Mover/Reagendar
          quedan visuales (gesto = Paso 4). Cancelar pide motivo antes de mutar. */}
      {cancelMode ? (
        <div className="border-t border-line bg-gradient-to-b from-canvas to-card px-5 pb-[18px] pt-[14px]">
          <label className="mb-1 block text-[11px] font-medium text-ink-2">Motivo de cancelación (opcional)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. el cliente pidió cancelar"
            autoFocus
            className="w-full rounded-[10px] border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-border"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { onCancel?.(appt.id, reason.trim()); onClose(); }}
              className="flex-1 rounded-pill border border-red-border bg-red-tint px-3 py-1.5 text-[12px] font-semibold text-red-ink transition hover:shadow-hero active:scale-95"
            >
              Cancelar cita
            </button>
            <button
              type="button"
              onClick={() => setCancelMode(false)}
              className="rounded-pill border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition hover:bg-card active:scale-95"
            >
              Volver
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-around border-t border-line bg-gradient-to-b from-canvas to-card px-5 pb-[18px] pt-[14px]">
          {actions.map((k) => {
            if (k === 'mensaje') {
              return waHref ? (
                <a key={k} href={waHref} target="_blank" rel="noopener noreferrer"
                   aria-label="Mensaje por WhatsApp" className="group flex flex-col items-center gap-1">
                  {chip(k)}
                </a>
              ) : (
                <button key={k} type="button" disabled title="Sin teléfono"
                        aria-label="Mensaje (sin teléfono)" className="flex flex-col items-center gap-1 opacity-40">
                  {chip(k)}
                </button>
              );
            }
            if (k === 'llamar') {
              return telHref ? (
                <a key={k} href={telHref} aria-label="Llamar" className="group flex flex-col items-center gap-1">
                  {chip(k)}
                </a>
              ) : (
                <button key={k} type="button" disabled title="Sin teléfono"
                        aria-label="Llamar (sin teléfono)" className="flex flex-col items-center gap-1 opacity-40">
                  {chip(k)}
                </button>
              );
            }
            return (
              <button
                key={k}
                type="button"
                aria-label={ACTION[k].label}
                onClick={() => run(k)}
                className="group flex flex-col items-center gap-1"
              >
                {chip(k)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantVerticalCalendar({
  date,
  timezone,
  appointments,
  staff,
  staffBlocks,
  onTapFreeSlot,
  walkinDefaultMin = 30,
  onPlace,
  walkinRequest,
  onWalkinConsumed,
  rescheduleRequest,
  onRescheduleConsumed,
  onInteractingChange,
  onNoShow,
  onComplete,
  onConfirm,
  onArrived,
  onCancel,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScrollRef = useRef<string | null>(null);

  // ── Cita seleccionada → card de detalle (Paso 3A). Local al calendario: la card
  //    es una preocupación visual del calendario; no toca al contenedor. ──
  const [selected, setSelected] = useState<Selection | null>(null);

  // ── Modo colocación (Paso 4B) — la cita levantada + destino en hover + confirmación.
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [placeHover, setPlaceHover] = useState<{ staffId: string; min: number } | null>(null);
  const [placeConfirm, setPlaceConfirm] = useState<PlaceConfirm | null>(null);

  // ── Drag para mover (Paso 4D) — forma alternativa de iniciar/dirigir el MISMO gesto
  //    de 4B (reusa placing/placeConfirm/confirmPlacement/onPlace). El drag solo aporta
  //    "arrastrar" en vez de "tocar-destino"; el reagendado y la validación son de 4B.
  const dragRef = useRef<
    { apptId: string; appt: DashboardAppointment; dur: number; startX: number; startY: number } | null
  >(null);
  const draggingRef = useRef(false);      // true una vez cruzado el umbral (es drag, no click)
  const dragTargetRef = useRef<PlaceConfirm | null>(null); // último destino VÁLIDO bajo el cursor
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollRaf = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null); // permite abortar el drag (Escape)
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; name: string; bar: string } | null>(null);

  // Entrar al modo colocación con una cita (desde la card o desde la cola de acción).
  // Cierra la card y arranca limpio (sin destino ni confirmación previa).
  const startPlacing = useCallback((a: DashboardAppointment) => {
    const s = isoToLocalMinutes(a.starts_at, timezone);
    const e = isoToLocalMinutes(a.ends_at, timezone);
    setSelected(null);
    setPlaceHover(null);
    setPlaceConfirm(null);
    setPlacing({
      apptId: a.id,
      staffId: a.staff.id,
      staffName: a.staff.name,
      dur: Math.max(15, e - s),
      name: a.customer?.name?.trim() || 'la cita',
      service: a.service?.name ?? '',
      startMin: s,
    });
  }, [timezone]);

  const cancelPlacing = useCallback(() => {
    setPlacing(null);
    setPlaceHover(null);
    setPlaceConfirm(null);
  }, []);

  // Esc: con confirmación pendiente → vuelve al hover; colocando → cancela el modo;
  // si no → cierra la card de detalle.
  useEffect(() => {
    if (!selected && !placing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Drag en curso → abortar el gesto (quita listeners/ghost/auto-scroll) además de
      // limpiar el modo colocación.
      if (draggingRef.current) { dragCleanupRef.current?.(); draggingRef.current = false; dragRef.current = null; }
      if (placeConfirm) { setPlaceConfirm(null); return; }
      if (placing) { cancelPlacing(); return; }
      setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, placing, placeConfirm, cancelPlacing]);

  // Pausar el polling del desk mientras se coloca (no regenerar el calendario a mitad
  // del gesto) — mismo contrato que usaba el panorama vía onInteractingChange.
  useEffect(() => {
    onInteractingChange?.(placing !== null);
  }, [placing, onInteractingChange]);

  // Walk-in: el vertical no implementa el drag del walk-in (usa onTapFreeSlot) → acusamos
  // y limpiamos para no dejar el botón "+ Walk-in" colgado.
  useEffect(() => {
    if (walkinRequest) onWalkinConsumed?.();
  }, [walkinRequest, onWalkinConsumed]);

  // "Mover" desde la cola de acción → RescheduleRequest. Lo honramos entrando al MISMO
  // modo colocación (cita fresca por id) y lo acusamos (one-shot, como el panorama).
  useEffect(() => {
    if (!rescheduleRequest) return;
    const a = appointments.find((x) => x.id === rescheduleRequest.apptId);
    if (a) startPlacing(a);
    onRescheduleConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescheduleRequest]);

  // ── Hora actual (poll 60s) — mismo patrón TZ-aware que el panorama ──
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  const [prevDateTz, setPrevDateTz] = useState(`${date}|${timezone}`);
  const dateTz = `${date}|${timezone}`;
  if (prevDateTz !== dateTz) {
    setPrevDateTz(dateTz);
    if (!isToday(date, timezone)) setNowMinutes(null);
  }
  useEffect(() => {
    if (!isToday(date, timezone)) return;
    const update = () => setNowMinutes(nowLocalMinutes(timezone));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [date, timezone]);

  // ── Rango de horas del día (min start / max end de barberos con turno) ──
  const hoursWithAvail = staff
    .map((s) => s.availabilityToday)
    .filter((a): a is NonNullable<typeof a> => a !== null);
  const startHour = hoursWithAvail.length > 0
    ? Math.min(...hoursWithAvail.map((a) => Math.floor(timeToMinutes(a.start_time) / 60)))
    : FALLBACK_START;
  const endHour = hoursWithAvail.length > 0
    ? Math.max(...hoursWithAvail.map((a) => Math.ceil(timeToMinutes(a.end_time) / 60)))
    : FALLBACK_END;

  const startMinutes = startHour * 60;
  const endMinutes   = endHour * 60;
  const totalMinutes = endMinutes - startMinutes;
  const totalHours   = endHour - startHour;
  const gridHeightPx = totalHours * HOUR_HEIGHT_PX;

  const minutesToPx = useCallback(
    (m: number) => (m - startMinutes) * PX_PER_MIN,
    [startMinutes],
  );

  // ── Auto-scroll: dejar "ahora" visible al montar / cambiar de día ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || didAutoScrollRef.current === dateTz) return;
    didAutoScrollRef.current = dateTz;
    if (!isToday(date, timezone)) { el.scrollTop = 0; return; }
    const nowTop = (nowLocalMinutes(timezone) - startMinutes) * PX_PER_MIN;
    // "ahora" a ~1/3 desde arriba (contexto previo visible), clamp a [0, max].
    el.scrollTop = Math.max(0, HEADER_HEIGHT_PX + nowTop - el.clientHeight / 3);
  }, [dateTz, date, timezone, startMinutes, gridHeightPx]);

  // Posición Y (px dentro del cuerpo) → minuto del slot, redondeado a 15 min y
  // acotado al rango. FUENTE ÚNICA para el click Y el feedback de hover: garantiza
  // que "lo que ves es lo que se agenda".
  const slotFromRelY = useCallback(
    (relY: number) => {
      const m = startMinutes + Math.round((relY / gridHeightPx) * totalMinutes / 15) * 15;
      return Math.max(startMinutes, Math.min(endMinutes - 15, m));
    },
    [startMinutes, endMinutes, totalMinutes, gridHeightPx],
  );

  // ── Click en hueco: posición Y → hora (redondeo a 15 min) → onTapFreeSlot ──
  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, staffId: string) => {
      if (!onTapFreeSlot) return;
      const rect = e.currentTarget.getBoundingClientRect();
      onTapFreeSlot(staffId, slotFromRelY(e.clientY - rect.top));
    },
    [onTapFreeSlot, slotFromRelY],
  );

  // ── Feedback de hora al hover sobre un hueco LIBRE (Paso 4A) ──
  // Muestra el slot de 15 min (redondeado, mismo cálculo que el click) donde caería
  // el walk-in. Solo si el slot es realmente reservable: dentro del turno del barbero,
  // sin cita ni bloqueo encima. Se apaga sobre cita/bloqueo/fuera-de-horario.
  const [hoverSlot, setHoverSlot] = useState<{ staffId: string; min: number } | null>(null);
  const handleColumnHover = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      staffId: string,
      availStart: number | null,
      availEnd: number | null,
      appts: DashboardAppointment[],
      blocks: PanoramaBlock[],
    ) => {
      if (!onTapFreeSlot) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const min = slotFromRelY(e.clientY - rect.top);
      const slotEnd = min + 15;
      const inHours = availStart !== null && availEnd !== null && min >= availStart && slotEnd <= availEnd;
      const overlaps = (s: string, en: string) => {
        const s0 = isoToLocalMinutes(s, timezone);
        const e0 = isoToLocalMinutes(en, timezone);
        return min < e0 && slotEnd > s0; // rangos se solapan
      };
      const free =
        inHours &&
        !appts.some((a) => overlaps(a.starts_at, a.ends_at)) &&
        !blocks.some((b) => overlaps(b.startsAt, b.endsAt));
      setHoverSlot((prev) =>
        free
          ? (prev && prev.staffId === staffId && prev.min === min ? prev : { staffId, min })
          : (prev === null ? prev : null),
      );
    },
    [onTapFreeSlot, slotFromRelY, timezone],
  );

  // ── Colocación: validez del destino (Paso 4B) ──
  // La action NO valida horario → lo gatea la UI (honesto, como el cap del walk-in):
  // dentro del turno del barbero destino, sin pisar cita (excluyendo la que se mueve)
  // ni bloqueo, y no en el pasado (solo hoy). El solape SÍ lo valida la action; acá lo
  // prevenimos para no ofrecer un destino que el server rechazaría.
  const isPlaceValid = useCallback(
    (
      min: number,
      dur: number,
      availStart: number | null,
      availEnd: number | null,
      appts: DashboardAppointment[],
      blocks: PanoramaBlock[],
      excludeId: string,
    ) => {
      if (availStart === null || availEnd === null) return false;
      const end = min + dur;
      if (min < availStart || end > availEnd) return false;
      const floor = isToday(date, timezone) && nowMinutes !== null ? nowMinutes : -Infinity;
      if (min < floor) return false;
      const ov = (s: string, en: string) => {
        const s0 = isoToLocalMinutes(s, timezone);
        const e0 = isoToLocalMinutes(en, timezone);
        return min < e0 && end > s0;
      };
      if (appts.some((a) => a.id !== excludeId && ov(a.starts_at, a.ends_at))) return false;
      if (blocks.some((b) => ov(b.startsAt, b.endsAt))) return false;
      return true;
    },
    [date, timezone, nowMinutes],
  );

  // Hover en modo colocación → el wash sigue el cursor solo en destinos válidos (en
  // inválidos se apaga: feedback honesto). Congelado mientras se confirma un destino.
  const handlePlaceHover = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      staffId: string,
      availStart: number | null,
      availEnd: number | null,
      appts: DashboardAppointment[],
      blocks: PanoramaBlock[],
    ) => {
      if (!placing || placeConfirm) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const min = slotFromRelY(e.clientY - rect.top);
      const valid = isPlaceValid(min, placing.dur, availStart, availEnd, appts, blocks, placing.apptId);
      setPlaceHover((prev) =>
        valid
          ? (prev && prev.staffId === staffId && prev.min === min ? prev : { staffId, min })
          : (prev === null ? prev : null),
      );
    },
    [placing, placeConfirm, slotFromRelY, isPlaceValid],
  );

  // Click en modo colocación → si el destino es válido, pide confirmación (mover MUTA);
  // si es inválido, no hace nada (el wash tampoco estaba ahí).
  const handlePlaceClick = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      staffId: string,
      staffName: string,
      availStart: number | null,
      availEnd: number | null,
      appts: DashboardAppointment[],
      blocks: PanoramaBlock[],
    ) => {
      if (!placing) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const min = slotFromRelY(e.clientY - rect.top);
      if (!isPlaceValid(min, placing.dur, availStart, availEnd, appts, blocks, placing.apptId)) return;
      setPlaceHover({ staffId, min });
      setPlaceConfirm({ staffId, staffName, min });
    },
    [placing, slotFromRelY, isPlaceValid],
  );

  // Confirmar → despacha al drop del desk (handlePlace → handleReschedule: optimista +
  // revert + toast + Deshacer). newStaffId puede diferir del original (mover de columna).
  const confirmPlacement = useCallback(() => {
    if (!placing || !placeConfirm || !onPlace) { cancelPlacing(); return; }
    onPlace(
      {
        kind: 'reschedule',
        apptId: placing.apptId,
        fromLaneId: placing.staffId,
        dur: placing.dur,
        name: placing.name,
        service: placing.service,
      },
      placeConfirm.staffId,
      placeConfirm.min,
    );
    cancelPlacing();
  }, [placing, placeConfirm, onPlace, cancelPlacing]);

  // ── Drag para mover (Paso 4D) — pointerdown sobre una cita arma un posible drag.
  // Si el cursor cruza el umbral con el botón abajo → es drag: entra al MISMO modo
  // colocación de 4B (startPlacing), un fantasma sigue el cursor y el wash marca el
  // destino bajo él; al soltar en destino válido → confirmación (reusa placeConfirm).
  // Si suelta sin cruzar el umbral → es click → el onClick del bloque abre la card.
  const onApptPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, appt: DashboardAppointment, barColor: string) => {
      if (placing) return;                 // click-to-place (botón "Mover") activo → drag no interfiere
      if (e.button !== 0) return;          // solo botón primario
      const dur = Math.max(15, isoToLocalMinutes(appt.ends_at, timezone) - isoToLocalMinutes(appt.starts_at, timezone));
      const name = appt.customer?.name?.trim() || 'la cita';
      dragRef.current = { apptId: appt.id, appt, dur, startX: e.clientX, startY: e.clientY };
      draggingRef.current = false;
      dragTargetRef.current = null;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      // Resolver el destino bajo el cursor: qué columna (data-col-staff), qué minuto
      // (mismo slotFromRelY del click-to-place) y si es válido (mismo isPlaceValid).
      function resolve(cx: number, cy: number): (PlaceConfirm & { valid: boolean }) | null {
        const el = document.elementFromPoint(cx, cy) as Element | null;
        const colEl = el?.closest?.('[data-col-staff]') as HTMLElement | null;
        if (!colEl) return null;
        const staffId = colEl.getAttribute('data-col-staff')!;
        const sObj = staff.find((x) => x.id === staffId);
        if (!sObj) return null;
        const av = sObj.availabilityToday;
        const availStart = av ? timeToMinutes(av.start_time) : null;
        const availEnd = av ? timeToMinutes(av.end_time) : null;
        const rect = colEl.getBoundingClientRect();
        const min = slotFromRelY(cy - rect.top);
        const appts = appointments.filter((a) => a.staff.id === staffId && a.status !== 'cancelled');
        const blocks = staffBlocks.filter((b) => b.staffId === staffId);
        const valid = isPlaceValid(min, dur, availStart, availEnd, appts, blocks, appt.id);
        return { staffId, staffName: sObj.name, min, valid };
      }

      function updateFromPointer(cx: number, cy: number) {
        lastPointerRef.current = { x: cx, y: cy };
        setDragGhost({ x: cx, y: cy, name, bar: barColor });
        const t = resolve(cx, cy);
        if (t && t.valid) {
          dragTargetRef.current = { staffId: t.staffId, staffName: t.staffName, min: t.min };
          setPlaceHover({ staffId: t.staffId, min: t.min });
        } else {
          dragTargetRef.current = null;
          setPlaceHover(null);
        }
      }

      // Auto-scroll cuando el cursor toca el borde sup/inf del área scrolleable — deja
      // soltar en horas fuera de vista. Adaptación vertical del EDGE_ZONE del panorama.
      function autoTick() {
        const sc = scrollRef.current;
        const p = lastPointerRef.current;
        if (sc && p) {
          const r = sc.getBoundingClientRect();
          let dir = 0;
          if (p.y < r.top + HEADER_HEIGHT_PX + EDGE_ZONE_PX) dir = -1;
          else if (p.y > r.bottom - EDGE_ZONE_PX) dir = 1;
          if (dir !== 0) {
            const before = sc.scrollTop;
            sc.scrollTop = Math.max(0, before + dir * AUTO_SCROLL_PX);
            if (sc.scrollTop !== before) updateFromPointer(p.x, p.y); // el contenido se movió bajo el cursor
          }
        }
        autoScrollRaf.current = requestAnimationFrame(autoTick);
      }

      function cleanup() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (autoScrollRaf.current) { cancelAnimationFrame(autoScrollRaf.current); autoScrollRaf.current = null; }
        setDragGhost(null);
        dragCleanupRef.current = null;
      }

      function onMove(ev: PointerEvent) {
        const d = dragRef.current;
        if (!d) return;
        lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
        if (!draggingRef.current) {
          if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD_PX) return; // aún es click potencial
          draggingRef.current = true;
          startPlacing(d.appt);                                   // reusa 4B: marca la cita + pausa polling
          autoScrollRaf.current = requestAnimationFrame(autoTick);
        }
        updateFromPointer(ev.clientX, ev.clientY);
      }

      function onUp() {
        const wasDragging = draggingRef.current;
        cleanup();
        draggingRef.current = false;
        dragRef.current = null;
        if (!wasDragging) return;                                 // no cruzó umbral → click → onClick abre la card
        // Suprimir el click "fantasma" que el navegador dispara tras el pointerup del drag.
        const killOnce = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault(); };
        window.addEventListener('click', killOnce, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', killOnce, true), 400);
        const t = dragTargetRef.current;
        if (t) setPlaceConfirm(t);                                // destino válido → confirmación (reusa 4B)
        else cancelPlacing();                                     // soltó en inválido → cancela, la cita vuelve
      }

      dragCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [placing, timezone, staff, appointments, staffBlocks, isPlaceValid, slotFromRelY, startPlacing, cancelPlacing],
  );

  if (staff.length === 0) {
    return (
      <div className="m-3 rounded-card border border-dashed border-line px-4 py-6 text-center">
        <p className="text-xs text-faint">Sin barberos con turno hoy.</p>
      </div>
    );
  }

  const nowTop = nowMinutes !== null ? minutesToPx(nowMinutes) : null;
  const showNow = nowTop !== null && nowTop >= 0 && nowTop <= gridHeightPx;

  // Selección efectiva: si la cita seleccionada sigue existiendo (tras poll/refresh)
  // usamos su versión fresca; si desapareció, la card no se muestra. Derivado (no
  // effect) → evita setState-en-effect y refresca los datos de la card.
  const freshAppt = selected ? appointments.find((a) => a.id === selected.appt.id) : undefined;
  const activeSel: Selection | null = selected && freshAppt ? { ...selected, appt: freshAppt } : null;

  return (
    <>
    <div
      ref={scrollRef}
      className="overflow-auto bg-card"
      // El shell del desk es min-h-dvh (crece con el contenido), así que el calendario
      // se acota a sí mismo para poseer su scroll (sticky + auto-scroll funcionan) en
      // vez de estirar la página. Cap ~ viewport menos el header del desk.
      style={{ maxHeight: 'calc(100dvh - 132px)', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
    >
      {/* w-max + min-w-full: pocos barberos → columnas llenan; muchos → scroll-X */}
      <div className="flex w-max min-w-full">

        {/* ── Columna de horas (sticky izquierda) ─────────────────────────── */}
        <div
          className="sticky left-0 z-30 shrink-0 border-r border-line bg-card"
          style={{ width: TIME_COL_WIDTH_PX }}
        >
          <div
            className="sticky top-0 z-10 border-b border-line bg-canvas"
            style={{ height: HEADER_HEIGHT_PX }}
          />
          <div className="relative" style={{ height: gridHeightPx }}>
            {Array.from({ length: totalHours }, (_, i) => (
              <span
                key={i}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-faint"
                style={{ top: i * HOUR_HEIGHT_PX }}
              >
                {String(startHour + i).padStart(2, '0')}:00
              </span>
            ))}
            {showNow && (
              <div
                className="absolute right-0.5 z-20 -translate-y-1/2 rounded-pill bg-red-ink px-1 py-px text-[9px] font-bold tabular-nums text-card shadow-card"
                style={{ top: nowTop! }}
                aria-hidden
              >
                {minutesToLabel(nowMinutes!)}
              </div>
            )}
            {/* Hora del hueco al hover, en la regla de tiempo (Paso 4A.2): se siente
                parte del gutter, no un cartel flotante. Teal, alineada con el wash.
                Se apaga en modo colocación (ahí manda la hora del destino de la cita). */}
            {!placing && hoverSlot && (
              <div
                className="absolute right-0.5 z-20 -translate-y-1/2 rounded-pill bg-teal-ink px-1 py-px text-[9px] font-bold tabular-nums text-card shadow-card"
                style={{ top: minutesToPx(hoverSlot.min) }}
                aria-hidden
              >
                {minutesToLabel(hoverSlot.min)}
              </div>
            )}
            {/* Hora del destino en modo colocación (Paso 4B) — misma pastilla del gutter,
                a la altura donde caería la cita movida. */}
            {placing && placeHover && (
              <div
                className="absolute right-0.5 z-20 -translate-y-1/2 rounded-pill bg-teal-ink px-1 py-px text-[9px] font-bold tabular-nums text-card shadow-card"
                style={{ top: minutesToPx(placeHover.min) }}
                aria-hidden
              >
                {minutesToLabel(placeHover.min)}
              </div>
            )}
          </div>
        </div>

        {/* ── Columnas por barbero ────────────────────────────────────────── */}
        {staff.map((s) => {
          const avail = s.availabilityToday;
          const availStart = avail ? timeToMinutes(avail.start_time) : null;
          const availEnd   = avail ? timeToMinutes(avail.end_time)   : null;

          const barberAppts = appointments.filter(
            (a) => a.staff.id === s.id && a.status !== 'cancelled',
          );
          const barberBlocks = staffBlocks.filter((b) => b.staffId === s.id);

          return (
            <div
              key={s.id}
              className="flex flex-col border-r border-line last:border-r-0"
              style={{ flex: '1 0 auto', minWidth: COL_MIN_WIDTH_PX }}
            >
              {/* Cabecera de barbero (sticky arriba) — avatar + nombre */}
              <div
                className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-canvas px-2.5"
                style={{ height: HEADER_HEIGHT_PX }}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-avatar bg-ink text-[10px] font-semibold text-card">
                  {initials(s.name)}
                </span>
                <span className="truncate text-[13px] font-semibold text-ink" title={s.name}>
                  {s.name}
                </span>
              </div>

              {/* Cuerpo — fuera de modo colocación: click crea walk-in. En modo
                  colocación: click = soltar la cita movida acá (los modos no se pisan). */}
              <div
                data-col-staff={s.id}
                role="button"
                tabIndex={0}
                aria-label={placing ? `Soltar la cita en ${s.name}` : `Crear cita para ${s.name}`}
                className="relative cursor-pointer"
                style={{ height: gridHeightPx }}
                onClick={(e) => {
                  if (draggingRef.current) return; // drag en curso → el pointerup lo resuelve
                  placing
                    ? handlePlaceClick(e, s.id, s.name, availStart, availEnd, barberAppts, barberBlocks)
                    : handleColumnClick(e, s.id);
                }}
                onMouseMove={(e) => {
                  if (draggingRef.current) return; // durante el drag manda el listener de pointer
                  placing
                    ? handlePlaceHover(e, s.id, availStart, availEnd, barberAppts, barberBlocks)
                    : handleColumnHover(e, s.id, availStart, availEnd, barberAppts, barberBlocks);
                }}
                onMouseLeave={() => {
                  if (placing) {
                    if (!placeConfirm) setPlaceHover((p) => (p && p.staffId === s.id ? null : p));
                    return;
                  }
                  setHoverSlot((p) => (p && p.staffId === s.id ? null : p));
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && onTapFreeSlot && !placing) {
                    e.preventDefault();
                    onTapFreeSlot(s.id, startMinutes + Math.floor(totalMinutes / 2));
                  }
                }}
              >
                {/* Guías de hora (horizontales) */}
                {Array.from({ length: totalHours }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-line"
                    style={{ top: i * HOUR_HEIGHT_PX }}
                  />
                ))}

                {/* Fuera de horario (antes del inicio) — tono canvas, sin opacity */}
                {availStart !== null && availStart > startMinutes && (
                  <div className="absolute left-0 right-0 bg-canvas" style={{ top: 0, height: minutesToPx(availStart) }} />
                )}
                {/* Fuera de horario (después del cierre) */}
                {availEnd !== null && availEnd < endMinutes && (
                  <div className="absolute left-0 right-0 bg-canvas" style={{ top: minutesToPx(availEnd), bottom: 0 }} />
                )}
                {/* Sin horario configurado → todo el día inactivo */}
                {avail === null && <div className="absolute inset-0 bg-canvas" />}

                {/* staff_blocks (bloqueos aprobados) — rayas Zentriq */}
                {barberBlocks.map((block, idx) => {
                  const bStart = isoToLocalMinutes(block.startsAt, timezone);
                  const bEnd   = isoToLocalMinutes(block.endsAt,   timezone);
                  const top    = minutesToPx(Math.max(bStart, startMinutes));
                  const bottom = minutesToPx(Math.min(bEnd,   endMinutes));
                  const height = Math.max(0, bottom - top);
                  if (height <= 0) return null;
                  return (
                    <div
                      key={idx}
                      className="absolute left-1 right-1 rounded-[8px]"
                      style={{
                        top, height,
                        background:
                          'repeating-linear-gradient(45deg, var(--color-past-line) 0 2px, var(--color-past-bg) 2px 7px)',
                      }}
                    />
                  );
                })}

                {/* Feedback del hueco al hover (Paso 4A.2) — wash sereno con forma de
                    cita-fantasma (tint-1 + acento teal a la izquierda, sin bordes duros
                    ni pastilla): "acá caería, a esta hora". Alto = duración por defecto
                    del walk-in, acotada al hueco real (hasta la próxima cita/bloqueo/
                    cierre). La hora va en el gutter. pointer-events-none. */}
                {!placing && hoverSlot && hoverSlot.staffId === s.id && (() => {
                  const slotMin = hoverSlot.min;
                  let limit = Math.min(endMinutes, availEnd ?? endMinutes);
                  for (const a of barberAppts) {
                    const s0 = isoToLocalMinutes(a.starts_at, timezone);
                    if (s0 > slotMin && s0 < limit) limit = s0;
                  }
                  for (const b of barberBlocks) {
                    const s0 = isoToLocalMinutes(b.startsAt, timezone);
                    if (s0 > slotMin && s0 < limit) limit = s0;
                  }
                  const washMin = Math.max(15, Math.min(walkinDefaultMin, limit - slotMin));
                  return (
                    <div
                      className="pointer-events-none absolute left-1 right-1 z-[6] rounded-[10px] bg-tint-1"
                      style={{
                        top: minutesToPx(slotMin),
                        height: washMin * PX_PER_MIN,
                        borderLeft: '2px solid var(--color-teal-border)',
                      }}
                      aria-hidden
                    />
                  );
                })()}

                {/* Wash del destino en modo colocación (Paso 4B) — mismo lenguaje sereno
                    que el hueco (tint-1 + acento teal), pero con el ALTO REAL de la cita
                    que se mueve. Marco punteado para leerlo como "destino" (aún no está
                    ahí). Solo en destinos válidos (isPlaceValid ya lo garantizó). */}
                {placing && placeHover && placeHover.staffId === s.id && (
                  <div
                    className="pointer-events-none absolute left-1 right-1 z-[7] rounded-[10px] bg-tint-1"
                    style={{
                      top: minutesToPx(placeHover.min),
                      height: placing.dur * PX_PER_MIN,
                      borderLeft: '2px solid var(--color-teal-border)',
                      outline: '1.5px dashed var(--color-teal-border)',
                      outlineOffset: '-1.5px',
                    }}
                    aria-hidden
                  />
                )}

                {/* Bloques de cita — estado por color/tono + info completa + badge bot */}
                {barberAppts.map((appt) => {
                  const apptStart = isoToLocalMinutes(appt.starts_at, timezone);
                  const apptEnd   = isoToLocalMinutes(appt.ends_at,   timezone);
                  const top       = minutesToPx(Math.max(apptStart, startMinutes));
                  const bottom    = minutesToPx(Math.min(apptEnd,   endMinutes));
                  const height    = Math.max(0, bottom - top);
                  if (height <= 0) return null;

                  const state = stateFor(appt, apptStart, apptEnd, nowMinutes);
                  const st    = STATE_STYLE[state];
                  const isWalk = appt.status === 'walkin' || appt.source === 'walkin';
                  const name = appt.customer?.name ?? (isWalk ? 'Walk-in' : 'Sin cliente');
                  const word = STATE_WORD[state];
                  const time = minutesToLabel(apptStart);
                  // Badge de source SOLO para bot: es la cita que agendó el asistente
                  // virtual (dato operativo útil). walk-in ya se lee por color; manual
                  // es "la hicimos nosotros" → sin badge. Se omite en bloques sin meta.
                  const showBot = appt.source === 'bot';
                  // Degradación por alto (1px/min): nombre siempre que quepa; meta
                  // (hora+estado+badge) desde ~26px; servicio desde ~42px.
                  const showName    = height >= 14;
                  const showMeta    = height >= 26;
                  const showService = height >= 42;
                  // La cita levantada (en movimiento): halo teal punteado (no opacity) +
                  // pastilla "moviendo". El resto del calendario queda como está.
                  const isMoving = placing?.apptId === appt.id;

                  return (
                    <div
                      key={appt.id}
                      className={`absolute left-1 right-1 overflow-hidden rounded-[10px] border border-line shadow-card ${st.bg} ${
                        state === 'late' ? 'animate-data-beat motion-reduce:animate-none' : ''
                      } ${
                        // Hover-que-infla (Paso 4C): SOLO fuera del modo colocación — durante
                        // el gesto de mover la cita levantada tiene su propio marcado y las
                        // demás no deben inflarse. Con card abierta el velo (z-40) ya tapa el
                        // calendario, así que el hover no dispara detrás → sin conflicto.
                        !placing ? `appt-hover ${GLOW_CLASS[state]}` : ''
                      }`}
                      style={{
                        top, height, padding: '4px 8px',
                        borderLeft: `3px solid ${st.bar}`,
                        outline: isMoving ? '2px dashed var(--color-teal-ink)' : undefined,
                        outlineOffset: isMoving ? '-2px' : undefined,
                        touchAction: 'none', // el drag (Paso 4D) es dueño del gesto sobre la cita en táctil
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Ver detalle de cita de ${name}`}
                      onPointerDown={(e) => onApptPointerDown(e, appt, st.bar)}
                      onClick={(e) => {
                        if (placing) return; // en colocación el bloque no abre card; el
                                             // click cae en la columna (destino inválido → no-op)
                        e.stopPropagation(); // no dispara el crear-en-hueco de la columna
                        setSelected({ appt, state, rect: e.currentTarget.getBoundingClientRect() });
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && !placing) {
                          e.preventDefault(); e.stopPropagation();
                          setSelected({ appt, state, rect: e.currentTarget.getBoundingClientRect() });
                        }
                      }}
                      title={`${time} · ${name} · ${appt.service.name}${word ? ` · ${word}` : ''}`}
                    >
                      {isMoving && (
                        <span className="absolute right-1 top-1 z-[1] rounded-pill bg-teal-ink px-1 py-px text-[8px] font-bold uppercase tracking-wide text-card">
                          moviendo
                        </span>
                      )}
                      {showName && (
                        <>
                          {showMeta && (
                            <div className={`flex items-center gap-1 whitespace-nowrap text-[9.5px] font-semibold tabular-nums ${st.ink}`}>
                              <span>{time}</span>
                              {word && <span className="font-medium">· {word}</span>}
                              {showBot && (
                                <span className="ml-auto shrink-0 rounded-pill border border-line px-1 text-[8px] font-semibold uppercase tracking-wide text-faint">
                                  bot
                                </span>
                              )}
                            </div>
                          )}
                          <div className={`truncate text-[12px] font-semibold ${st.ink}`}>{name}</div>
                          {showService && (
                            <div className="truncate text-[9.5px] text-faint">{appt.service.name}</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Banda sutil del "ahora": franja tenue + hairline crisp (Paso 3A) */}
                {showNow && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 flex h-3 -translate-y-1/2 items-center"
                    style={{ top: nowTop! }}
                    aria-hidden
                  >
                    <div className="absolute inset-0 bg-red-ink/[0.06]" />
                    <div className="relative h-px w-full bg-red-ink" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {/* Card de detalle — velo claro sutil (NO oscuro) + card flotante anclada */}
    {activeSel && (
      <>
        <div
          className="fixed inset-0 z-40 bg-canvas/50 backdrop-blur-[2px]"
          onClick={() => setSelected(null)}
          aria-hidden
        />
        <DetailCard
          sel={activeSel}
          timezone={timezone}
          nowMinutes={nowMinutes}
          onClose={() => setSelected(null)}
          onNoShow={onNoShow}
          onComplete={onComplete}
          onConfirm={onConfirm}
          onArrived={onArrived}
          onCancel={onCancel}
          onMove={startPlacing}
        />
      </>
    )}

    {/* ── Modo colocación (Paso 4B): barra "Moviendo" / confirmación del destino ── */}
    {placing && (
      <div
        role="status"
        className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-pill border border-teal-border bg-tint-1 px-4 py-2 text-sm font-semibold text-teal-ink shadow-hero"
      >
        {placeConfirm ? (
          <>
            <span>
              ¿Mover a {placing.name} a las{' '}
              <span className="tabular-nums">{minutesToLabel(placeConfirm.min)}</span>
              {placeConfirm.staffId !== placing.staffId ? ` · con ${placeConfirm.staffName}` : ''}?
            </span>
            <button
              type="button"
              onClick={confirmPlacement}
              className="-my-0.5 rounded-pill bg-teal px-3 py-0.5 text-xs font-bold text-card transition hover:opacity-90 active:scale-95"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setPlaceConfirm(null)}
              className="-my-0.5 rounded-pill border border-current px-2.5 py-0.5 text-xs font-bold transition hover:bg-card/40"
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-pill bg-teal-ink animate-data-beat motion-reduce:animate-none" aria-hidden />
              Moviendo a {placing.name} · tocá el nuevo horario
            </span>
            <button
              type="button"
              onClick={cancelPlacing}
              className="-my-0.5 rounded-pill border border-current px-2.5 py-0.5 text-xs font-bold transition hover:bg-card/40"
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    )}

    {/* Fantasma del drag (Paso 4D) — sigue al cursor mientras se arrastra la cita.
        pointer-events-none para no interferir con elementFromPoint (resolución del
        destino). La hora del destino va en el gutter (placeHover); acá solo el nombre. */}
    {dragGhost && (
      <div
        className="pointer-events-none fixed z-[60] max-w-[200px] truncate rounded-[10px] border border-line bg-card px-2.5 py-1.5 text-[12px] font-semibold text-ink shadow-hero"
        style={{ left: dragGhost.x + 12, top: dragGhost.y + 8, borderLeft: `3px solid ${dragGhost.bar}` }}
        aria-hidden
      >
        {dragGhost.name}
      </div>
    )}
    </>
  );
}
