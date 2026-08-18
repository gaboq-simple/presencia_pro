// ─── actividadDias — el archivo se agrupa por DÍA (dv3-5'') ──────────────────
// Módulo puro (sin DB, sin red, sin React). Toma los eventos del feed ya ordenados
// por fecha descendente y los parte en bloques de día, con la etiqueta que va en
// el kicker.
//
// Por qué existe, más allá de la forma: hasta ahora cada fila decía su tiempo en
// RELATIVO ("hace 3 min", "ayer"). Eso tiene tres problemas y el rediseño los
// resuelve de una: en un archivo el tiempo relativo obliga a hacer la cuenta en
// la cabeza para ubicar algo; dos filas de días distintos se ven igual; y —el que
// más costó— hace **imposible comparar dos capturas**, porque el texto cambia
// solo con el reloj. Con el día en el kicker y la hora de pared en la fila, la
// misma información queda estable y ubicable.
//
// El día es el día LOCAL DEL NEGOCIO, no el del navegador de quien mira: el
// archivo cuenta lo que pasó en la barbería.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Lo mínimo que este módulo necesita de un evento. */
export type ConFecha = { at: string };

export type DiaBloque<T extends ConFecha> = {
  /** 'YYYY-MM-DD' local del negocio — clave estable, no la etiqueta. */
  fecha:     string;
  /** "Hoy · martes 18" · "Ayer · lunes 17" · "sábado 16 de agosto". */
  etiqueta:  string;
  eventos:   T[];
};

/** Partes de fecha locales de un instante, en la tz del negocio. */
function partes(iso: string, timeZone: string): { fecha: string; dow: number; dia: number; mes: number } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const [y, m, dd] = fecha.split('-').map(Number);
  // El día de la semana se saca de la fecha LOCAL ya resuelta (mediodía UTC evita
  // que el propio cálculo cruce de día por el offset).
  const dow = new Date(Date.UTC(y!, m! - 1, dd!, 12)).getUTCDay();
  return { fecha, dow, dia: dd!, mes: m! - 1 };
}

/** 'YYYY-MM-DD' desplazado en días, sin depender de la tz del proceso. */
function correrDia(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

/**
 * Agrupa en bloques por día local, **conservando el orden de entrada**: el feed
 * llega ordenado por `created_at DESC` y este módulo no re-ordena nada. Si un
 * evento trae fecha inválida, cae en su propio bloque sin etiqueta de día en vez
 * de desaparecer — un archivo que se traga filas no sirve como archivo.
 */
export function agruparPorDia<T extends ConFecha>(
  eventos: readonly T[],
  timeZone: string,
  hoyLocal: string,
): Array<DiaBloque<T>> {
  const ayer = correrDia(hoyLocal, -1);
  const bloques: Array<DiaBloque<T>> = [];

  for (const ev of eventos) {
    const p = partes(ev.at, timeZone);
    const fecha = p?.fecha ?? '';
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && ultimo.fecha === fecha) {
      ultimo.eventos.push(ev);
      continue;
    }
    bloques.push({
      fecha,
      etiqueta: p === null ? 'Sin fecha' : etiquetaDia(p, fecha, hoyLocal, ayer),
      eventos: [ev],
    });
  }
  return bloques;
}

function etiquetaDia(
  p: { dow: number; dia: number; mes: number },
  fecha: string,
  hoyLocal: string,
  ayer: string,
): string {
  const nombre = `${DIAS[p.dow]} ${p.dia}`;
  if (fecha === hoyLocal) return `Hoy · ${nombre}`;
  if (fecha === ayer) return `Ayer · ${nombre}`;
  // Más atrás, el mes deja de ser obvio y entra en la etiqueta.
  return `${nombre} de ${MESES[p.mes]}`;
}

/** 'HH:MM' de pared del negocio — la hora que va a la derecha de cada fila. */
export function horaLocal(iso: string, timeZone: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(new Date(t));
}
