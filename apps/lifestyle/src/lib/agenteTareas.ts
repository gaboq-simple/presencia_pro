// ─── Máquina de estados de las tareas del agente — ESPEJO, no autoridad ──────
// Módulo PURO (sin DB, sin red, sin React). Espeja el mapa que vive en
// `supabase/migrations/20260821000000_agente_tareas.sql` para que la UI pueda
// saber qué ofrecer y para que un caller sepa por qué algo no se va a poder,
// **antes** de ir a la base.
//
// 🔴 La autoridad es la BD, no este archivo. `agente_tarea_transicionar()` valida
// lo mismo y rebota igual aunque este módulo diga que sí: la app entra con
// service_role y una validación que solo vive en el cliente no es una garantía,
// es una sugerencia. Este módulo existe para dar buenos mensajes, no para
// autorizar.
//
// Los dos mapas se mantienen sincronizados por `tests/agenteTareas.repo.test.ts`,
// que LEE el `CASE` de la migración y rompe el build si divergen — el patrón de
// `timeWindows.repo.test.ts`: la disciplina como gate, no como memoria.
//
// Plan: docs/planes/agente-fase-1.md (A3) · Contrato: docs/planes/agente.md

export const ESTADOS = ['propuesta', 'aprobada', 'ejecutada', 'medida', 'descartada'] as const;
export type EstadoTarea = (typeof ESTADOS)[number];

export const ACTORES = ['staff', 'agente', 'system'] as const;
export type ActorTipo = (typeof ACTORES)[number];

/**
 * El mapa. Espejo EXACTO de `agente_tarea_permitidas(text)` en la migración.
 *
 * `medida` y `descartada` son terminales, y no por simetría: una descartada que
 * pudiera volver a `propuesta` haría que la decisión del dueño caducara sola, que
 * es justo lo que el primitivo viene a impedir.
 */
export const TRANSICIONES: Readonly<Record<EstadoTarea, readonly EstadoTarea[]>> = {
  propuesta:  ['aprobada', 'descartada'],
  aprobada:   ['ejecutada', 'descartada'],
  ejecutada:  ['medida'],
  medida:     [],
  descartada: [],
};

/** Estados de los que ya no se sale. Se derivan del mapa: una lista aparte se
 *  desincronizaría en el primer cambio. */
export const TERMINALES: readonly EstadoTarea[] =
  ESTADOS.filter((e) => TRANSICIONES[e].length === 0);

/** Decidir es de una persona: aprobar y descartar exigen `staff` con id. */
export function exigeActorHumano(hasta: EstadoTarea): boolean {
  return hasta === 'aprobada' || hasta === 'descartada';
}

/** Medir exige el resultado: sin él, "medida" afirma algo que no se sabe. */
export function exigeResultado(hasta: EstadoTarea): boolean {
  return hasta === 'medida';
}

export function esTerminal(estado: EstadoTarea): boolean {
  return TRANSICIONES[estado].length === 0;
}

export function puedeTransicionar(desde: EstadoTarea, hasta: EstadoTarea): boolean {
  return TRANSICIONES[desde].includes(hasta);
}

export type Transicion = {
  desde:        EstadoTarea;
  hasta:        EstadoTarea;
  actorTipo:    ActorTipo;
  actorStaffId: string | null;
  resultado:    unknown;
};

export type ValidacionTransicion = { ok: true } | { ok: false; error: string };

/**
 * Las mismas tres reglas que la función de la BD, en el mismo orden y con
 * mensajes equivalentes. Devuelve `{ ok:false, error }` en vez de tirar: es el
 * patrón `{ error }` de las server actions (Next redacta los throw en
 * producción — lección de S6-SEC-02).
 */
export function validarTransicion(t: Transicion): ValidacionTransicion {
  if (!puedeTransicionar(t.desde, t.hasta)) {
    const permitidas = TRANSICIONES[t.desde];
    return {
      ok: false,
      error: permitidas.length === 0
        ? `${t.desde} es un estado terminal: no se puede pasar a ${t.hasta}`
        : `${t.desde} → ${t.hasta} no es una transición válida (desde ${t.desde} solo se puede ir a ${permitidas.join(' o ')})`,
    };
  }

  if (exigeActorHumano(t.hasta) && (t.actorTipo !== 'staff' || !t.actorStaffId)) {
    return { ok: false, error: `pasar a ${t.hasta} exige un actor humano identificado` };
  }

  if (exigeResultado(t.hasta) && (t.resultado === null || t.resultado === undefined)) {
    return { ok: false, error: 'pasar a medida exige resultado' };
  }

  return { ok: true };
}

/** Qué se le puede ofrecer a quien está mirando la tarea. Un actor no humano no
 *  ve "Aprobar" ni "Descartar" — la UI no debería poder ofrecer lo que la BD va
 *  a rebotar. */
export function siguientesPara(estado: EstadoTarea, actorTipo: ActorTipo): readonly EstadoTarea[] {
  return TRANSICIONES[estado].filter((h) => !exigeActorHumano(h) || actorTipo === 'staff');
}
