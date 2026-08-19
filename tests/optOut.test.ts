// ─── Tests del detector de baja (S8-PER-01 · P2) ─────────────────────────────
// Lo que fijan, y ninguna de las tres se puede mover sin cambiar el significado:
//
//   · **La frontera negativa manda.** "quiero darme de baja del gimnasio" NO
//     dispara. Un falso negativo lo corrige el cliente escribiendo otra vez; un
//     falso positivo silencia a alguien que no pidió nada y solo se descubre
//     cuando reclama. Ante la duda, `false`.
//   · El match es por MENSAJE COMPLETO, no contenido — es lo que hace posible la
//     frontera de arriba (misma lección que `isAffirmation`, donde los tokens
//     cortos exigen mensaje completo por la misma razón).
//   · Acentos, mayúsculas y puntuación no cambian nada: "¡BAJA!" es "baja".
//
// Y una que no es del detector pero sí del paso: ninguna de las frases de baja
// choca con las 15 keywords ARCO, así que interceptar la baja ANTES de ARCO no
// le roba mensajes a ARCO.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isOptOutCommand, OPT_OUT_CONFIRMATION } from '../apps/lifestyle/src/lib/opt-out';

// ─── Positivos ────────────────────────────────────────────────────────────────

test('las frases de baja disparan', () => {
  for (const s of [
    'baja', 'BAJA', 'Baja', '  baja  ', '¡BAJA!', 'baja.',
    'stop', 'STOP',
    'no me manden mensajes', 'No me manden mensajes.',
    'no quiero mensajes',
    'dejen de escribir', 'dejen de escribirme',
    'no me escriban',
    'darme de baja', 'quiero darme de baja',
  ]) {
    assert.equal(isOptOutCommand(s), true, `debería disparar: ${s!}`);
  }
});

// ─── ★ La frontera negativa ───────────────────────────────────────────────────

test('★ "quiero darme de baja del gimnasio" NO dispara', () => {
  assert.equal(isOptOutCommand('quiero darme de baja del gimnasio'), false);
});

test('la baja no se dispara desde adentro de una frase', () => {
  for (const s of [
    'me quiero dar de baja del seguro',
    'la baja de mi papá fue ayer',
    '¿tienen precio de baja temporada?',
    'stop motion',
    'no me manden mensajes de otros negocios pero sí los suyos',
    'hola, quiero una cita',
    'ok',
  ]) {
    assert.equal(isOptOutCommand(s), false, `NO debería disparar: ${s}`);
  }
});

test('entradas degeneradas no revientan y no disparan', () => {
  assert.equal(isOptOutCommand(''), false);
  assert.equal(isOptOutCommand('   '), false);
  assert.equal(isOptOutCommand('...'), false);
  assert.equal(isOptOutCommand(undefined as unknown as string), false);
  assert.equal(isOptOutCommand(42 as unknown as string), false);
});

// ─── La frontera con ARCO ─────────────────────────────────────────────────────

test('ninguna frase de baja contiene una keyword ARCO', () => {
  // Copia literal de ARCO_KEYWORDS (router.ts). Si allá se agrega una que choque,
  // este test lo dice antes de que un opt-out se coma una solicitud ARCO.
  const ARCO = [
    'mis datos', 'mis derechos', 'quiero mis datos', 'borrar mis datos',
    'eliminar mis datos', 'derechos arco', 'datos personales', 'privacidad',
    'derecho de acceso', 'rectificacion', 'cancelacion de datos', 'oposicion',
    'ley de datos', 'lfpdppp', 'aviso de privacidad',
  ];
  const BAJAS = [
    'baja', 'stop', 'no me manden mensajes', 'no quiero mensajes',
    'dejen de escribir', 'dejen de escribirme', 'no me escriban',
    'darme de baja', 'quiero darme de baja',
  ];
  for (const b of BAJAS) {
    for (const a of ARCO) {
      assert.ok(!b.includes(a), `la frase de baja "${b}" contiene la keyword ARCO "${a}"`);
    }
  }
});

test('un mensaje ARCO no dispara la baja', () => {
  for (const s of ['quiero mis datos', 'borrar mis datos', 'aviso de privacidad', 'derechos arco']) {
    assert.equal(isOptOutCommand(s), false, `ARCO no debe caer en baja: ${s}`);
  }
});

// ─── La confirmación ──────────────────────────────────────────────────────────

test('la confirmación no negocia ni pide confirmar de nuevo', () => {
  const c = OPT_OUT_CONFIRMATION.toLowerCase();
  assert.ok(c.includes('no te volveremos a enviar mensajes'));
  for (const prohibido of ['¿estás seguro', 'seguro?', 'confirma', 'promoción', 'oferta', 'antes de irte']) {
    assert.ok(!c.includes(prohibido), `la confirmación no debe negociar: contiene "${prohibido}"`);
  }
  // Deja la puerta abierta sin condicionar la baja.
  assert.ok(c.includes('aquí estamos'));
});
