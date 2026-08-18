// ─── diaRail — el día como RIEL de tiempo (dv3-4') ────────────────────────────
// Módulo puro (sin DB, sin red, sin React). Convierte las citas del día en las
// filas que pinta `components/admin/DiaRail.tsx`.
//
// El cambio de forma que este módulo encarna: la agenda del dueño era una PILA
// de 21 cajas iguales, y una agenda no es una pila — es tiempo. En un riel, el
// hueco de 40 minutos entre dos citas es una FILA que se ve; en la pila era la
// ausencia de una caja, o sea nada. Por eso los huecos se calculan acá y no se
// dejan implícitos.
//
// Tres reglas que el módulo fija y no se mueven sin cambiar el significado:
//
//   1. **El pasado se distingue por COLOR, no por opacidad** — eso lo aplica el
//      componente; acá solo se marca `pasado`. El corte es `starts_at < ahora`
//      (orden del riel = hora de inicio): una cita que ya arrancó queda detrás
//      de la línea "ahora", que es donde el ojo la busca.
//   2. **Un hueco es un tramo en el que NADIE está con un cliente** — no "un
//      barbero libre". Se calcula barriendo las citas fusionadas: mientras
//      alguien atienda, el negocio no tiene hueco. Los nombres que acompañan al
//      hueco son los barberos EN TURNO en ese tramo (por su horario del día,
//      descontando su descanso), porque "30 min libres" sin decir de quién no
//      sirve para colocar a nadie.
//   3. **La ventana se ancla en "ahora", no en el inicio del día.** Un tope de
//      8 filas contadas desde las 9 de la mañana le muestra al dueño, a las 7 de
//      la tarde, ocho citas que ya pasaron. El pliegue `<details>` conserva
//      TODAS: plegar no es esconder.
//
// `now` se inyecta siempre — sin reloj real no hay test determinista.

import { hhmmInTz, minutosLocalesInTz } from './dayWindow';

// ─── Constantes tuneables (un solo lugar) ─────────────────────────────────────

/** Un tramo libre más corto que esto es ruido de agenda, no un hueco vendible. */
export const HUECO_MIN_MINUTOS = 15;

/** Tope de filas de CITA en el nivel 1. El resto vive en el `<details>`. */
export const TOPE_CITAS = 8;

/** De las `TOPE_CITAS`, cuántas del pasado se conservan como contexto. */
export const CITAS_PASADAS_EN_VENTANA = 2;

/** Con más de estos barberos libres, el hueco dice el conteo y no la lista. */
const MAX_NOMBRES_HUECO = 3;

// ─── Entradas ─────────────────────────────────────────────────────────────────

/** Una cita del día, ya aplanada desde `DashboardAppointment`. */
export type RailAppt = {
  id:          string;
  startsAt:    string;          // ISO UTC
  endsAt:      string;          // ISO UTC
  status:      string;
  staffId:     string;
  staffName:   string;
  serviceName: string | null;
  clientName:  string | null;
};

/** El turno de un barbero ese día (staff_availability). `null` = no trabaja. */
export type RailTurno = {
  staffId:    string;
  staffName:  string;
  startTime:  string;           // 'HH:MM[:SS]' hora local del negocio
  endTime:    string;
  breakStart: string | null;
  breakEnd:   string | null;
};

export type DiaRailInput = {
  citas:    readonly RailAppt[];
  turnos:   readonly RailTurno[];
  /** Índice categórico por barbero — `lib/staffColors.staffColorIndex`. */
  colorPorStaff: ReadonlyMap<string, number>;
  timezone: string;
  /** Instante de referencia. */
  nowMs:    number;
  /** ¿El día que se está viendo es HOY en la tz del negocio? */
  esHoy:    boolean;
};

// ─── Salida ───────────────────────────────────────────────────────────────────

export type RailEstado =
  | 'completada' | 'no_vino' | 'cancelada' | 'confirmada' | 'pendiente' | 'walkin';

export type RailRow =
  | {
      kind:       'cita';
      id:         string;
      hora:       string;        // 'HH:MM' local
      colorIndex: number;
      /** Quién viene. Es la línea grande: ver la nota de `filaDe`. */
      principal:  string;
      /** Servicio · barbero. La línea chica. */
      secundario: string;
      estado:     RailEstado;
      pasado:     boolean;
    }
  | { kind: 'hueco'; id: string; minutos: number; libres: string }
  | { kind: 'ahora'; id: string; hora: string };

export type DiaRail = {
  /** Lo que se pinta en el nivel 1 (ventana anclada en "ahora"). */
  ventana:     RailRow[];
  /** El riel COMPLETO, para el `<details>`. */
  todas:       RailRow[];
  totalCitas:  number;
  /** Citas que quedaron fuera de la ventana (0 → no hay pliegue que ofrecer). */
  ocultas:     number;
  completadas: number;
  /** Citas del día que todavía no se resolvieron (ni completed, ni no_show, ni cancelled). */
  porAtender:  number;
  /** Barberos con al menos una cita hoy, en el orden fijo del color. */
  leyenda:     Array<{ staffId: string; name: string; colorIndex: number }>;
};

// ─── Helpers puros ────────────────────────────────────────────────────────────

const ESTADO_POR_STATUS: Record<string, RailEstado> = {
  completed: 'completada',
  no_show:   'no_vino',
  cancelled: 'cancelada',
  confirmed: 'confirmada',
  pending:   'pendiente',
  walkin:    'walkin',
};

/** Los estados que ya se resolvieron — su complemento es "por atender". */
const RESUELTOS = new Set<RailEstado>(['completada', 'no_vino', 'cancelada']);

export function estadoDeStatus(status: string): RailEstado {
  return ESTADO_POR_STATUS[status] ?? 'pendiente';
}

/** 'HH:MM[:SS]' → minutos desde medianoche. Formato inválido → null. */
function hmToMin(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "Andrés y Beto" · "Andrés, Beto y Diego" · "4 barberos". */
export function listarLibres(nombres: readonly string[]): string {
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return nombres[0]!;
  if (nombres.length > MAX_NOMBRES_HUECO) return `${nombres.length} barberos`;
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * Las dos líneas de una fila. El NOMBRE DEL CLIENTE va arriba, no el servicio.
 *
 * La maqueta pone "Corte · Miguel Ochoa" en una línea, y con sus servicios
 * cortos entra; con los reales ("Barba / afeitado clásico") el ancho de 375 px
 * se lo come el servicio y lo que se trunca es el nombre — que es justo lo único
 * que la fila tiene que decir. Es la misma lección que ya costó una corrección
 * en dv3-3', donde el cliente del feed de rescate quedaba en "A…".
 *
 * Sin cliente (walk-in anónimo) el servicio sube a principal: la línea grande
 * nunca queda vacía.
 */
function textoDe(c: RailAppt): { principal: string; secundario: string } {
  if (c.clientName) {
    return {
      principal:  c.clientName,
      secundario: [c.serviceName, c.staffName].filter(Boolean).join(' · '),
    };
  }
  return { principal: c.serviceName ?? 'Sin servicio', secundario: c.staffName };
}

/** Barberos en turno en el instante `ms` (fuera de su descanso). */
function enTurno(turnos: readonly RailTurno[], ms: number, timezone: string): string[] {
  const min = minutosLocalesInTz(ms, timezone);
  return turnos
    .filter((t) => {
      const ini = hmToMin(t.startTime);
      const fin = hmToMin(t.endTime);
      if (ini === null || fin === null || min < ini || min >= fin) return false;
      const bi = hmToMin(t.breakStart);
      const bf = hmToMin(t.breakEnd);
      if (bi !== null && bf !== null && min >= bi && min < bf) return false;
      return true;
    })
    .map((t) => t.staffName);
}

// ─── Cómputo ──────────────────────────────────────────────────────────────────

export function computeDiaRail(input: DiaRailInput): DiaRail {
  const { citas, turnos, colorPorStaff, timezone, nowMs, esHoy } = input;

  const ordenadas = [...citas].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id),
  );

  // ── Filas de cita + huecos intercalados ────────────────────────────────────
  // El barrido lleva el MÁXIMO fin visto: mientras alguien siga atendiendo no hay
  // hueco de negocio, aunque la siguiente cita arranque mucho después de que
  // terminó la anterior en orden de inicio.
  const todas: RailRow[] = [];
  let maxFinMs = -Infinity;
  let completadas = 0;
  let porAtender = 0;

  for (const c of ordenadas) {
    const iniMs = Date.parse(c.startsAt);
    const finMs = Date.parse(c.endsAt);

    if (Number.isFinite(maxFinMs) && iniMs > maxFinMs) {
      const minutos = Math.round((iniMs - maxFinMs) / 60000);
      if (minutos >= HUECO_MIN_MINUTOS) {
        const medio = maxFinMs + (iniMs - maxFinMs) / 2;
        todas.push({
          kind:    'hueco',
          id:      `hueco-${maxFinMs}`,
          minutos,
          libres:  listarLibres(enTurno(turnos, medio, timezone)),
        });
      }
    }

    const estado = estadoDeStatus(c.status);
    if (estado === 'completada') completadas++;
    if (!RESUELTOS.has(estado)) porAtender++;

    todas.push({
      kind:       'cita',
      id:         c.id,
      hora:       hhmmInTz(c.startsAt, timezone),
      colorIndex: colorPorStaff.get(c.staffId) ?? 0,
      ...textoDe(c),
      estado,
      pasado:     esHoy ? iniMs < nowMs : nowMs > finMs,
    });

    if (Number.isFinite(finMs)) maxFinMs = Math.max(maxFinMs, finMs);
  }

  // ── La línea "ahora" ───────────────────────────────────────────────────────
  // Solo existe si el día que se ve ES hoy: dibujarla en el día de mañana sería
  // una línea del presente sobre un tiempo que no ha pasado.
  let iAhora = -1;
  if (esHoy) {
    const primeraFutura = todas.findIndex((r) => r.kind === 'cita' && !r.pasado);
    iAhora = primeraFutura === -1 ? todas.length : primeraFutura;
    todas.splice(iAhora, 0, {
      kind: 'ahora',
      id:   'ahora',
      hora: hhmmInTz(new Date(nowMs).toISOString(), timezone),
    });
  }

  // ── Ventana anclada en "ahora" ─────────────────────────────────────────────
  const idxCitas = todas.reduce<number[]>((acc, r, i) => {
    if (r.kind === 'cita') acc.push(i);
    return acc;
  }, []);
  const totalCitas = idxCitas.length;

  let ventana: RailRow[] = [];
  if (totalCitas > 0) {
    const nPasadas = todas.filter((r) => r.kind === 'cita' && r.pasado).length;
    const nFuturas = totalCitas - nPasadas;

    // El tope es un TECHO, no una cuota: si solo quedan 4 citas por delante, la
    // ventana son 2 de contexto + esas 4, y no se rellena hacia atrás con pasado
    // para llegar a 8 — el pasado es contexto, no contenido.
    //
    // Las dos excepciones son los bordes del día, donde "anclarse en ahora" no
    // dice nada: si ya no queda nada por atender, lo útil son las últimas ocho;
    // si todavía no empezó, las primeras ocho. Sin "ahora" (otro día) la ventana
    // es el principio del día — no hay presente al que anclarse.
    const pasadasEnVentana = !esHoy
      ? 0
      : nFuturas === 0
        ? Math.min(nPasadas, TOPE_CITAS)
        : Math.min(nPasadas, CITAS_PASADAS_EN_VENTANA);
    const desdeCita = esHoy ? nPasadas - pasadasEnVentana : 0;
    const hastaCita = desdeCita + Math.min(TOPE_CITAS, totalCitas - desdeCita) - 1;

    const iDesde = idxCitas[desdeCita]!;
    const iHasta = idxCitas[hastaCita]!;
    ventana = todas.slice(iDesde, iHasta + 1);

    // La línea "ahora" nunca se pierde por el recorte: si cayó fuera del tramo
    // (todo el día ya pasó, o todavía no empezó), se pega al borde que le toca.
    if (iAhora !== -1 && (iAhora < iDesde || iAhora > iHasta)) {
      const fila = todas[iAhora]!;
      if (iAhora < iDesde) ventana.unshift(fila);
      else ventana.push(fila);
    }

    // Un hueco en el borde de la ventana no tiene contexto (le falta uno de sus
    // dos lados): se cae. Adentro sí, ahí sí dice algo.
    while (ventana[0]?.kind === 'hueco') ventana.shift();
    while (ventana[ventana.length - 1]?.kind === 'hueco') ventana.pop();
  } else if (iAhora !== -1) {
    ventana = [todas[iAhora]!];
  }

  const visibles = ventana.filter((r) => r.kind === 'cita').length;

  return {
    ventana,
    todas,
    totalCitas,
    ocultas: totalCitas - visibles,
    completadas,
    porAtender,
    leyenda: leyendaDe(ordenadas, colorPorStaff),
  };
}

/** Barberos con cita hoy, en el orden fijo del color (no por volumen). */
function leyendaDe(
  citas: readonly RailAppt[],
  colorPorStaff: ReadonlyMap<string, number>,
): DiaRail['leyenda'] {
  const vistos = new Map<string, string>();
  for (const c of citas) if (!vistos.has(c.staffId)) vistos.set(c.staffId, c.staffName);
  return [...vistos.entries()]
    .map(([staffId, name]) => ({ staffId, name, colorIndex: colorPorStaff.get(staffId) ?? 0 }))
    .sort((a, b) => a.colorIndex - b.colorIndex);
}
