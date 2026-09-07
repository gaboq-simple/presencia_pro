// ─── Qué se le puede hacer a una cita: la tabla de acciones (P8) ──────────────
// El defecto que motiva estos tests (auditoría 2026-09-03, R1 punto 3): "Terminó"
// para una cita AGENDADA no existía en el camino principal de la mesa. La tabla
// solo lo ofrecía para `walk`, y el único "Terminó" de una cita normal vivía
// dentro del acordeón CERRADO de cabos sueltos.
//
// La función vivía adentro de `AssistantVerticalCalendar.tsx`, donde no se podía
// probar: por eso la regresión de P8 podía pasar meses sin que nada la marcara.
// Ahora es un módulo puro y su tabla está fijada acá.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, VENTANA_LLEGADA_MIN } from '../apps/lifestyle/src/lib/apptActions';

const INICIO = 10 * 60; // 10:00

test('P8 — una cita confirmada que YA LLEGÓ ofrece Terminó', () => {
  const a = actionsFor('curso', INICIO, INICIO + 5, true);
  assert.ok(a.includes('termino'), 'sin "Terminó" el gesto más frecuente del día no existe');
});

test('P8 — y "No llegó" desaparece cuando la persona ya está adentro', () => {
  // Ofrecerlo sería invitar a escribir un hecho falso sobre alguien presente.
  const a = actionsFor('curso', INICIO, INICIO + 5, true);
  assert.ok(!a.includes('noLlego'));
});

test('P8 — antes de la llegada se decide sobre la persona, no sobre el cobro', () => {
  const a = actionsFor('conf', INICIO, INICIO - 5, false);
  assert.deepEqual(a, ['llego', 'noLlego', 'mensaje', 'cancelar']);
  // "Terminó" NO se ofrece acá a propósito: llegar ahí exigiría marcar
  // `arrived_at` con el instante del tap, que no es cuando la persona cruzó la
  // puerta. Esa cita se cierra en el paso ① de "Cerrar el día".
  assert.ok(!a.includes('termino'));
});

test('la ventana anticipada abre exactamente 10 minutos antes, no antes', () => {
  const justo = actionsFor('conf', INICIO, INICIO - VENTANA_LLEGADA_MIN, false);
  assert.ok(justo.includes('llego'));
  const antes = actionsFor('conf', INICIO, INICIO - VENTANA_LLEGADA_MIN - 1, false);
  assert.deepEqual(antes, ['mensaje', 'mover', 'cancelar']);
});

test('una cita atrasada que llegó también ofrece Terminó (era el caso del cabo)', () => {
  // `late` = la ventana pasó y nadie la cerró. Es EXACTAMENTE la cita que después
  // aparecía en el acordeón de cabos; ahora se cierra donde se está mirando.
  const a = actionsFor('late', INICIO, INICIO + 90, true);
  assert.ok(a.includes('termino'));
});

test('parado en otro día no hay "ahora", así que no se decide sobre llegadas', () => {
  const a = actionsFor('conf', INICIO, null, false);
  assert.deepEqual(a, ['mensaje', 'mover', 'cancelar']);
});

test('lo terminal no ofrece cerrar nada: solo reagendar y contactar', () => {
  for (const st of ['done', 'noshow'] as const) {
    const a = actionsFor(st, INICIO, INICIO + 5, false);
    assert.deepEqual(a, ['reagendar', 'mensaje', 'llamar']);
    assert.ok(!a.includes('termino'));
  }
});

test('el walk-in conserva su set: Terminó primero, y "Llegó" solo si le falta', () => {
  // S9-OPS-03: el walk-in de hoy nace llegado; el parado en otro día, no.
  assert.deepEqual(actionsFor('walk', INICIO, INICIO, true),
    ['termino', 'mensaje', 'mover', 'cancelar']);
  assert.deepEqual(actionsFor('walk', INICIO, null, false),
    ['termino', 'llego', 'mensaje', 'cancelar']);
});

test('una cita por confirmar se confirma, no se cobra', () => {
  const a = actionsFor('pending', INICIO, INICIO + 5, false);
  assert.deepEqual(a, ['confirmar', 'mensaje', 'mover', 'cancelar']);
});

test('ningún estado ofrece más de cuatro acciones (el pie de la ficha es fijo)', () => {
  const estados = ['conf', 'pending', 'curso', 'late', 'done', 'noshow', 'walk'] as const;
  for (const st of estados) {
    for (const arrived of [true, false]) {
      for (const now of [null, INICIO - 60, INICIO - 5, INICIO + 5, INICIO + 90]) {
        assert.ok(actionsFor(st, INICIO, now, arrived).length <= 4, `${st}/${arrived}/${now}`);
      }
    }
  }
});
