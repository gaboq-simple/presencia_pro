// ─── Tests de la ventana al bot: "atendidas por tu equipo" ───────────────────
// El número mide CONVERSACIONES en las que respondió una persona del equipo,
// contadas sobre `conversation_messages` (sent_by='human') y no sobre
// `bot_conversations.taken_at`.
//
// Por qué cambió la fuente: `releaseConversation` pone `taken_at = NULL`, así
// que contar ahí solo veía lo que seguía EN MANOS de una persona — devolver la
// conversación al bot, que es el desenlace sano, borraba el caso del conteo.
//
// Lo que estos casos fijan, y no se puede mover sin romperlos:
//   · una charla con varias respuestas humanas cuenta UNA (contar filas era el
//     error fácil, y el más común en la vida real);
//   · sin mensajes humanos el número es 0, no 1;
//   · dos personas distintas atendidas cuentan dos.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contarAtendidasPorEquipo, type MensajeHumano } from '../apps/lifestyle/src/lib/analisis';

const msgs = (...tels: string[]): MensajeHumano[] => tels.map((t) => ({ customer_phone: t }));

test('sin mensajes humanos, cero', () => {
  assert.equal(contarAtendidasPorEquipo([]), 0);
});

test('una conversación con varias respuestas humanas cuenta UNA', () => {
  const filas = msgs('5215541000001', '5215541000001', '5215541000001', '5215541000001');
  assert.equal(contarAtendidasPorEquipo(filas), 1);

  // CONTRAPRUEBA: si el conteo fuera de filas y no de conversaciones, este mismo
  // caso daría 4. La aserción de arriba pasaría por casualidad con un solo
  // mensaje; con cuatro, solo pasa si de verdad se deduplica.
  assert.notEqual(contarAtendidasPorEquipo(filas), filas.length);
});

test('dos conversaciones distintas cuentan dos', () => {
  assert.equal(contarAtendidasPorEquipo(msgs('5215541000001', '5215541000002')), 2);
});

test('mezcla: tres conversaciones entre siete mensajes', () => {
  const filas = msgs(
    '5215541000001', '5215541000002', '5215541000001',
    '5215541000003', '5215541000003', '5215541000001', '5215541000003',
  );
  assert.equal(contarAtendidasPorEquipo(filas), 3);
  assert.notEqual(contarAtendidasPorEquipo(filas), 7);
});

test('el orden de los mensajes no cambia el número', () => {
  const a = msgs('5215541000002', '5215541000001', '5215541000002');
  const b = msgs('5215541000001', '5215541000002', '5215541000002');
  assert.equal(contarAtendidasPorEquipo(a), contarAtendidasPorEquipo(b));
});
