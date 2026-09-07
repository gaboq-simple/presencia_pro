// ─── Qué se le puede hacer a una cita, según su estado y el momento ───────────
// Módulo PURO: sin DB, sin red, sin React. Vivía adentro de
// `components/staff/AssistantVerticalCalendar.tsx`, donde no se podía probar; sale
// acá por el mismo reparto que el resto del repo (la matemática no toca la BD, y
// la vista no decide reglas).
//
// LA REGLA QUE ESTE MÓDULO SOSTIENE (P8 de la auditoría 2026-09-03, R1 punto 3):
// "Terminó" para una cita AGENDADA no existía en el camino principal. La tabla
// solo lo ofrecía para `walk`, y el único "Terminó" de una cita normal vivía
// dentro del acordeón CERRADO de cabos sueltos, rotulado "de los últimos 14
// días". El gesto más frecuente del día estaba archivado como excepción.
//
// LO QUE SE OFRECE NUNCA PUEDE SER UN HECHO IMPOSIBLE. Una vez que la persona
// llegó, "No llegó" ya no puede ser cierto: ofrecerlo es invitar a escribir algo
// falso. Por eso el par se conmuta —llegó ⇒ Terminó; todavía no ⇒ Llegó/No
// llegó— en vez de acumular botones.
//
// Y NO se ofrece "Terminó" antes de la llegada, aunque ahorraría un tap: para
// llegar ahí habría que marcar `arrived_at` con el instante del tap, que no es
// el instante en que la persona cruzó la puerta. La cita que ya terminó y a la
// que nadie le marcó la llegada se cierra en el paso ① de "Cerrar el día"
// (`CajaModule`), que ofrece "Terminó" directo y deja `arrived_at` en NULL — "no
// sé cuándo llegó", que es la verdad, y no una hora inventada.

export type BlockState = 'conf' | 'pending' | 'curso' | 'late' | 'done' | 'noshow' | 'walk';

export type ActionKey =
  | 'mensaje' | 'mover' | 'cancelar' | 'confirmar'
  | 'llego' | 'noLlego' | 'termino' | 'reagendar' | 'llamar';

/** Ventana anticipada, en minutos, que habilita el par Llegó/No llegó. */
export const VENTANA_LLEGADA_MIN = 10;

/**
 * EL WALK-IN, que es el caso raro y ya estaba resuelto (S9-OPS-03): el de HOY nace
 * llegado —lo estampa `createAssistantAppointment`— y conserva su set de siempre,
 * con "Terminó" primero, que es para lo que se abre esa ficha; el parado en otro
 * día nace sin llegada, y ahí "Llegó" es la única puerta que tiene. El set son
 * cuatro acciones, así que en ese caso "Llegó" entra en lugar de "Mover": sin
 * "Llegó" ese walk-in no tiene forma de protegerse del auto-cancel, y sin "Mover"
 * solo pierde un atajo que el arrastre del calendario ya ofrece.
 *
 * @param state     estado del bloque (status + momento)
 * @param apptStart minutos desde medianoche del inicio de la cita (tz negocio)
 * @param nowM      minutos desde medianoche de "ahora", o `null` si el día que se
 *                  mira no es hoy (sin "ahora" no hay ventana ni curso/late)
 * @param arrived   si ya se registró la llegada (`arrived_at` no nulo)
 */
export function actionsFor(
  state: BlockState, apptStart: number, nowM: number | null, arrived: boolean,
): ActionKey[] {
  if (state === 'done')    return ['reagendar', 'mensaje', 'llamar'];
  if (state === 'noshow')  return ['reagendar', 'mensaje', 'llamar'];
  if (state === 'walk')    return arrived
    ? ['termino', 'mensaje', 'mover', 'cancelar']
    : ['termino', 'llego', 'mensaje', 'cancelar'];
  if (state === 'pending') return ['confirmar', 'mensaje', 'mover', 'cancelar'];
  // conf / curso / late — dentro de la ventana se decide sobre la persona.
  const inWindow = nowM !== null && nowM >= apptStart - VENTANA_LLEGADA_MIN;
  if (inWindow) {
    return arrived
      ? ['termino', 'mensaje', 'mover', 'cancelar']
      : ['llego', 'noLlego', 'mensaje', 'cancelar'];
  }
  return ['mensaje', 'mover', 'cancelar'];
}
