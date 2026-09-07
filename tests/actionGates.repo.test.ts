// ─── Repo-check: cada server action declara su gate, y el gate está fijado ─────
// El defecto que lo motivó (S9-SEC-02): `requireAssistantSession()` no comprueba
// el rol — solo exige que haya sesión — y de ese gate colgaban cuatro actions que
// CONFIGURAN el negocio. Un barbero con su PIN podía reescribirle el horario
// semanal a un compañero, mientras la ruta HTTP equivalente exigía `owner|admin`.
//
// El problema de fondo no es que un gate estuviera flojo: es que **el gate de una
// action no se ve**. Está adentro de la función, en la primera línea, y agregar
// una action nueva no obliga a nadie a pensar en quién puede llamarla. Una server
// action es un endpoint HTTP público con un id estable; "la UI no lo muestra" no
// es una defensa.
//
// Este check hace visible ese mapa y lo congela: si alguien agrega, borra o
// cambia el gate de una action, la suite se cae hasta que actualice la tabla de
// abajo A PROPÓSITO. No decide qué gate corresponde — eso es criterio humano;
// obliga a que la decisión exista y quede escrita.
//
// Puro: lee un archivo del repo, sin DB ni red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MODULO = 'apps/lifestyle/src/app/staff/assistant-actions.ts';

/**
 * El mapa vigente. `asistente` = cualquier miembro del negocio con sesión
 * (`requireAssistantSession`); `dueño` = `requireOwnerOrAdmin`.
 *
 * Regla de oro para editarlo: lo que MUTA LA CONFIGURACIÓN del negocio (quién
 * trabaja, cuándo, con qué precio) es `dueño`. Lo que es la operación del día
 * —citas, llegadas, cobros, conversaciones— es `asistente`, porque el mostrador
 * tiene que poder trabajar sin ir a buscar al dueño.
 */
const GATES: Record<string, 'asistente' | 'dueño'> = {
  // ── Operación del día ──────────────────────────────────────────────────────
  refreshAssistantAppointments: 'asistente',
  cancelAppointment:            'asistente',
  updateAppointmentNotes:       'asistente',
  completeAppointment:          'asistente',
  noShowAppointment:            'asistente',
  confirmAppointment:           'asistente',
  markArrived:                  'asistente',
  // Registrar "avisó que llega tarde" es operación del día, no configuración: lo
  // atiende quien toma la llamada. Un barbero solo puede hacerlo sobre SUS citas
  // (`assertBarberOwnsAppointment`), igual que el resto de sus mutaciones.
  registrarRetraso:             'asistente',
  // Declarar el riel de un cobro que nació sin él es cierre del día, no
  // configuración: lo hace quien está cerrando la caja. Un barbero solo sobre SUS
  // citas (`assertBarberOwnsAppointment`), y la BD solo deja RELLENAR — el
  // predicado lleva `.is('payment_method', null)`, así que ni con el gate abierto
  // se puede reescribir una atribución ya declarada (M2 de S10-ASIS-01).
  listarCobrosSinRiel:          'asistente',
  asignarRiel:                  'asistente',
  createAssistantAppointment:   'asistente',
  rescheduleAppointment:        'asistente',
  getStaffBlocksForDay:         'asistente',
  searchCustomers:              'asistente',
  takeoverConversation:         'asistente',
  releaseConversation:          'asistente',
  sendMessageFromPanel:         'asistente',
  getActiveConversations:       'asistente',
  getConversationMessages:      'asistente',
  // ── Configuración del negocio (S9-SEC-02) ──────────────────────────────────
  createScheduleException:      'dueño',
  deleteScheduleException:      'dueño',
  getScheduleExceptions:        'dueño',
};

/**
 * Nombre de cada action exportada → el guard que invoca.
 *
 * El cuerpo se corta en la SIGUIENTE action, no en una ventana de N caracteres.
 * La primera versión de este archivo usaba una ventana fija y su propia
 * contraprueba la reventó: el texto de una función sin guard se desbordaba sobre
 * la que seguía y heredaba el gate del vecino — o sea que una action sin ningún
 * guard podía leerse como protegida. Se deja escrito porque es exactamente el
 * tipo de falso verde que un candado tiene que no tener.
 */
function gatesDelModulo(src: string): Record<string, string> {
  const encontrado: Record<string, string> = {};
  const re = /export async function (\w+)\s*\(/g;
  const matches = [...src.matchAll(re)];

  matches.forEach((m, i) => {
    const nombre = m[1] as string;
    const desde = m.index ?? 0;
    const hasta = matches[i + 1]?.index ?? src.length;
    const cuerpo = src.slice(desde, hasta);
    if (cuerpo.includes('requireOwnerOrAdmin(')) encontrado[nombre] = 'dueño';
    else if (cuerpo.includes('requireAssistantSession(')) encontrado[nombre] = 'asistente';
    else encontrado[nombre] = 'SIN GATE';
  });
  return encontrado;
}

test('toda action exportada tiene un gate, y es el que la tabla declara', () => {
  const real = gatesDelModulo(readFileSync(MODULO, 'utf8'));

  const sinGate = Object.entries(real).filter(([, g]) => g === 'SIN GATE').map(([n]) => n);
  assert.deepEqual(sinGate, [], `hay actions exportadas sin ningún guard: ${sinGate.join(', ')}`);

  assert.deepEqual(
    real,
    GATES,
    'el gate de alguna action cambió, o hay una action nueva. Si es a propósito, ' +
    'actualizá GATES en este archivo; si no, el cambio abre (o cierra) una puerta.',
  );
});

test('ninguna action de configuración quedó del lado del mostrador', () => {
  const real = gatesDelModulo(readFileSync(MODULO, 'utf8'));
  // Las tres de excepciones de horario son el caso de S9-SEC-02. Se nombran una
  // por una: si alguien las afloja, este test dice cuál y por qué importa.
  for (const n of ['createScheduleException', 'deleteScheduleException', 'getScheduleExceptions']) {
    assert.equal(
      real[n], 'dueño',
      `${n} configura quién trabaja qué día: con gate de mostrador, un barbero por PIN ` +
      `puede cambiarle el calendario a un compañero y sacarlo de la disponibilidad del bot`,
    );
  }
});

test('updateStaffSchedule no volvió a existir', () => {
  // Se borró en S9-SEC-02: no tenía llamadores y duplicaba, sin gate ni audit, lo
  // que `PATCH /api/staff/[id]/schedule` ya hace con `owner|admin`, zod y snapshot.
  const src = readFileSync(MODULO, 'utf8');
  assert.ok(
    !/export async function updateStaffSchedule/.test(src),
    'volvió la segunda puerta al horario semanal: si hace falta, va por la ruta HTTP',
  );
});

// ─── Contraprueba: el candado tiene que poder fallar ──────────────────────────

test('CONTRAPRUEBA — una action sin guard o con el gate aflojado se detecta', () => {
  const conDefecto = `
    export async function borrarTodo(id: string): Promise<void> {
      const supabase = getServiceClient();
    }
    export async function createScheduleException(d: unknown): Promise<void> {
      const session = await requireAssistantSession();
    }
  `;
  const real = gatesDelModulo(conDefecto);
  assert.equal(real['borrarTodo'], 'SIN GATE', 'una action sin guard tiene que salir marcada');
  assert.equal(
    real['createScheduleException'], 'asistente',
    'un gate aflojado tiene que leerse distinto al declarado en GATES',
  );
  assert.notEqual(real['createScheduleException'], GATES['createScheduleException']);
});
