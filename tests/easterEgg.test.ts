// Easter egg — comando oculto del bot.
// Puro y determinista: sin red, sin Supabase, sin Anthropic.
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkEasterEgg } from '../packages/engine/src/bot/lifestyle/easterEgg';

const EXPECTED = '¡Feliz cumpleaños, ermabog! Hora de hacer GAZILLIONS';

test('checkEasterEgg dispara con el código exacto', () => {
  assert.equal(checkEasterEgg('69B741'), EXPECTED);
});

test('checkEasterEgg es case-insensitive', () => {
  assert.equal(checkEasterEgg('69b741'), EXPECTED);
});

test('checkEasterEgg ignora espacios al inicio/final', () => {
  assert.equal(checkEasterEgg('  69B741  '), EXPECTED);
});

test('checkEasterEgg no dispara con un mensaje normal', () => {
  assert.equal(checkEasterEgg('hola'), null);
});

test('checkEasterEgg no dispara si hay texto extra junto al código', () => {
  assert.equal(checkEasterEgg('69B741 algo más'), null);
});

// Nota: cuando checkEasterEgg devuelve una cadena, el handler del webhook
// (apps/lifestyle/src/app/api/bot/route.ts) responde con ella y retorna
// inmediatamente — ANTES de rate limit, bufferAndProcess, processMetaMessage,
// handoffGate y el FSM. No se invoca handleLifestyleMessage ni se escribe en
// bot_conversations, por lo que el estado de la conversación queda intacto.
