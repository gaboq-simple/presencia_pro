// S4-BOT-06 (FASE B) — Bot propositivo que ofrece horarios reales.
// Puros y deterministas: sin red, sin Supabase, sin Anthropic.
// Ejecutar: npm test
//
// Cubre:
//   1. Detector isAvailabilityQuestion: reconoce preguntas de disponibilidad
//      ("¿qué horario hay mañana?", "¿a qué hora tienes?") y NO confunde
//      peticiones directas ("quiero un corte mañana").
//   2. El mensaje determinista que el bot construye para responder
//      "¿qué horario hay mañana?" CONTIENE horarios concretos (ofrece), no solo
//      una pregunta de vuelta.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isAvailabilityQuestion } from '../packages/engine/src/bot/lifestyle/availabilityIntent';
import { buildSlotsMessage } from '../packages/engine/src/bot/lifestyle/states/presentingSlots';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { SlotCandidate } from '../packages/engine/src/bot/lifestyle/types';

const TZ = 'America/Mexico_City';

// ─── 1. Detector ──────────────────────────────────────────────────────────────

test('isAvailabilityQuestion: reconoce preguntas de disponibilidad', () => {
  const positives = [
    '¿qué horario hay mañana?',
    'que horarios tienes el viernes',
    '¿a qué hora tienes?',
    'a que horas hay lugar',
    'que disponibilidad hay',
    'tienes disponibilidad mañana?',
    'hay disponibilidad el sábado',
    'que horarios disponibles tienen',
    '¿cuándo puedo ir?',
    'cuando tienes espacio',
    'que espacios hay',
    'que dias tienes',
  ];
  for (const p of positives) {
    assert.equal(isAvailabilityQuestion(p), true, `debe detectar: "${p}"`);
  }
});

test('isAvailabilityQuestion: NO confunde peticiones directas ni vacío', () => {
  const negatives = [
    'quiero un corte mañana',
    'agéndame con Carlos el viernes',
    'mañana a las 5',
    'sí, confirmo',
    'hola buenas tardes',
    '',
    '   ',
  ];
  for (const n of negatives) {
    assert.equal(isAvailabilityQuestion(n), false, `NO debe detectar: "${n}"`);
  }
});

// ─── 2. El bot OFRECE horarios concretos ──────────────────────────────────────

function makeSlot(date: string, time: string, staffId: string, staffName: string): SlotCandidate {
  const startsAt = localTimeToUTC(date, time, TZ);
  const endsAt   = localTimeToUTC(date, time, TZ);
  return { staffId, staffName, startsAt, endsAt };
}

test('buildSlotsMessage (autoAssign): ofrece horarios concretos, no solo una pregunta', () => {
  // Disponibilidad real mockeada para "mañana": 11:00, 13:00, 17:00.
  const slots: SlotCandidate[] = [
    makeSlot('2026-06-11', '11:00', 's1', 'Carlos'),
    makeSlot('2026-06-11', '13:00', 's2', 'Luis'),
    makeSlot('2026-06-11', '17:00', 's3', 'Ana'),
  ];

  const msg = buildSlotsMessage(slots, /* isWalkIn */ false, /* autoAssign */ true, TZ);

  // CONTIENE horarios concretos (ofrece opciones reales).
  assert.match(msg, /11 de la mañana/);
  assert.match(msg, /1 de la tarde/);
  assert.match(msg, /5 de la tarde/);

  // autoAssign → no menciona nombres de barbero.
  assert.doesNotMatch(msg, /Carlos|Luis|Ana/);

  // El mensaje no es SOLO una pregunta: incluye los horarios (dígitos de hora).
  assert.ok(/\d/.test(msg), 'el mensaje contiene horarios con números');
});

test('buildSlotsMessage: hora exacta no disponible → comunica y ofrece la alternativa concreta', () => {
  const slots: SlotCandidate[] = [
    makeSlot('2026-06-11', '16:00', 's1', 'Carlos'),
    makeSlot('2026-06-11', '18:00', 's2', 'Luis'),
  ];

  const msg = buildSlotsMessage(
    slots, false, true, TZ,
    /* exactMatchMissed */ true,
    /* requestedTimeLabel */ '5 de la tarde',
  );

  assert.match(msg, /no tengo disponible/);
  // Ofrece las alternativas concretas más cercanas.
  assert.match(msg, /4 de la tarde/);
  assert.match(msg, /6 de la tarde/);
});
