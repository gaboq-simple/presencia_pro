// ─── panoramaEngine ───────────────────────────────────────────────────────────
// Aritmética PURA de disponibilidad de la mesa de control (S6-UI-02). Sin React,
// sin DB, sin red. Fuente ÚNICA de "dónde cabe un servicio":
//   · el GESTO click-to-place (PanoramaTimeline.laneDrops) pinta chips con esto.
//   · la COLA de acción (ActionQueue) calcula la jugada sugerida de un atrasado
//     con `firstCompatibleSlot` — el MISMO cálculo, no una copia.
//
// Todo en minutos-desde-medianoche en la tz del NEGOCIO. Extraído del §6 del
// HANDOFF; portado de PanoramaTimeline en PR-5 para no divergir (honestidad de
// disponibilidad).

export type Interval = { start: number; end: number };

// Cita de un carril, lo mínimo para clasificar solape.
export type OverlapAppt = { id: string; start: number; dur: number; name: string };

// Carril reducido a lo que necesita el cálculo de huecos.
export type EngineLane = {
  staffId: string;
  availFrom: number;   // inicio del turno (min)
  availTo: number;     // fin del turno (min)
  unavail: Interval[]; // descanso + bloqueos (frontera DURA)
  appts: OverlapAppt[];// citas del carril (para clasificar solape)
};

// ─── Helpers de tiempo (tz del negocio) ────────────────────────────────────────

export function partsInTz(iso: string, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    min: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

export function minutesOfDay(iso: string, timeZone: string): number {
  return partsInTz(iso, timeZone).min;
}

// 'HH:MM:SS' → minutos desde medianoche.
export function hhmmToMin(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = ((min % 60) + 60) % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 || h >= 24 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Inicios candidatos dentro de un hueco ─────────────────────────────────────

// Horas SUGERIDAS: lo antes posible + :00/:30 reales, ≥30 min entre sí.
export function suggestedStarts(a: number, b: number, dur: number): number[] {
  const last = b - dur; // último inicio donde el servicio cabe
  const out = [a];
  for (let g = Math.ceil((a + 1) / 30) * 30; g <= last + 0.5; g += 30) {
    if (g - out[out.length - 1]! >= 30) out.push(g);
  }
  return out;
}

// Ajuste fino: cada 15 min dentro del hueco donde cabe.
export function fineStarts(a: number, b: number, dur: number): number[] {
  const last = b - dur;
  const out: number[] = [];
  for (let m = Math.ceil(a / 15) * 15; m <= last + 0.5; m += 15) out.push(m);
  if ((out.length === 0 || out[0]! > a) && a <= last) out.unshift(a);
  return out;
}

// ─── Tiempo físicamente disponible ─────────────────────────────────────────────

// Intervalos libres dentro de [domainStart, domainEnd] restando `unavail`
// (descanso + bloqueos). Frontera DURA: nunca se ofrece un destino dentro de esto.
export function availableIntervals(
  unavail: Interval[],
  domainStart: number,
  domainEnd: number,
): Interval[] {
  const blocked = unavail
    .map((u) => [u.start, u.end] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  let cur = domainStart;
  for (const [bs, be] of blocked) {
    if (be <= cur) continue;
    if (bs > cur) out.push({ start: cur, end: Math.min(bs, domainEnd) });
    cur = Math.max(cur, be);
    if (cur >= domainEnd) break;
  }
  if (cur < domainEnd) out.push({ start: cur, end: domainEnd });
  return out;
}

// Solape MAYOR de [start, start+dur] contra las citas dadas (0 = limpio). El
// caller ya excluye la cita levantada si aplica.
export function overlapAt(
  start: number,
  dur: number,
  appts: OverlapAppt[],
): { min: number; name: string } {
  let min = 0;
  let name = '';
  for (const b of appts) {
    const ov = Math.min(start + dur, b.start + b.dur) - Math.max(start, b.start);
    if (ov > 0 && ov > min) {
      min = Math.round(ov);
      name = b.name;
    }
  }
  return { min, name };
}

// ─── Primer hueco compatible (jugada sugerida de la cola) ──────────────────────

// El primer inicio LIMPIO (sin solape) ≥ floor donde `dur` cabe, recorriendo los
// carriles; devuelve el más TEMPRANO global (desempata por orden de carril). Es la
// sugerencia de 1-tap del atrasado: "recorrer al primer hueco". `excludeId` = la
// cita que se está moviendo (no cuenta como solape de sí misma). Ignora la ventana
// visible a propósito: la sugerencia es hora-reloj real, no de presentación.
export function firstCompatibleSlot(
  lanes: EngineLane[],
  dur: number,
  floor: number,
  excludeId?: string,
): { staffId: string; min: number } | null {
  let best: { staffId: string; min: number } | null = null;
  for (const lane of lanes) {
    const domainStart = Math.max(lane.availFrom, floor);
    const domainEnd = lane.availTo;
    if (domainEnd - domainStart < dur) continue;
    const appts = excludeId ? lane.appts.filter((a) => a.id !== excludeId) : lane.appts;
    for (const av of availableIntervals(lane.unavail, domainStart, domainEnd)) {
      const last = av.end - dur;
      if (last < av.start - 0.5) continue;
      for (const s of suggestedStarts(av.start, av.end, dur)) {
        if (s > last + 0.5) continue;
        if (overlapAt(s, dur, appts).min > 0) continue; // solo limpios
        if (!best || s < best.min) best = { staffId: lane.staffId, min: s };
      }
    }
  }
  return best;
}
