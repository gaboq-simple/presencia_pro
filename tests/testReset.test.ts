// Guardas del comando de reset de prueba (/reset-bot).
// Puro y determinista: sin red, sin Supabase, sin Anthropic, sin process.env
// (la allowlist se inyecta como parámetro). Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isTestResetCommand,
  isTestPhoneAllowlisted,
  TEST_RESET_TRIGGER,
} from '../apps/lifestyle/src/lib/test-reset';

const PHONE      = '5215512345678';        // en allowlist
const OTHER      = '5210000000000';        // fuera de allowlist
const ALLOWLIST  = '5215512345678';        // CSV de un número

// ─── Guarda 2: trigger exacto (no substring) ──────────────────────────────────

test('trigger exacto + teléfono en allowlist → dispara', () => {
  assert.equal(isTestResetCommand(PHONE, '/reset-bot', ALLOWLIST), true);
});

test('trigger exacto con espacios alrededor → dispara (trim)', () => {
  assert.equal(isTestResetCommand(PHONE, '  /reset-bot  ', ALLOWLIST), true);
});

test('substring que contiene "reset" NO dispara — "quiero resetear mi cita"', () => {
  assert.equal(isTestResetCommand(PHONE, 'quiero resetear mi cita', ALLOWLIST), false);
});

test('substring que contiene el trigger NO dispara — "/reset-bot porfa"', () => {
  assert.equal(isTestResetCommand(PHONE, '/reset-bot porfa', ALLOWLIST), false);
});

test('la palabra suelta "reset" NO dispara', () => {
  assert.equal(isTestResetCommand(PHONE, 'reset', ALLOWLIST), false);
});

test('texto que empieza distinto pero contiene el trigger NO dispara', () => {
  assert.equal(isTestResetCommand(PHONE, 'hola /reset-bot', ALLOWLIST), false);
});

// ─── Guarda 1: allowlist ──────────────────────────────────────────────────────

test('número fuera de la allowlist NO dispara (aunque el trigger sea exacto)', () => {
  assert.equal(isTestResetCommand(OTHER, '/reset-bot', ALLOWLIST), false);
});

test('allowlist vacía → falla cerrado', () => {
  assert.equal(isTestResetCommand(PHONE, '/reset-bot', ''), false);
});

test('allowlist ausente (undefined) → falla cerrado', () => {
  assert.equal(isTestResetCommand(PHONE, '/reset-bot', undefined), false);
});

test('allowlist solo con comas/espacios → falla cerrado', () => {
  assert.equal(isTestResetCommand(PHONE, '/reset-bot', ' , , '), false);
});

// ─── Variantes de formato y CSV ───────────────────────────────────────────────

test('CSV con varios números — match en el segundo', () => {
  assert.equal(isTestResetCommand(PHONE, '/reset-bot', `${OTHER},${PHONE}`), true);
});

test('CSV con espacios alrededor de las entradas → normaliza y matchea', () => {
  assert.equal(isTestResetCommand(PHONE, '/reset-bot', `  ${OTHER} ,  ${PHONE}  `), true);
});

test('allowlist con "+" y teléfono sin "+" → normaliza y matchea', () => {
  assert.equal(isTestResetCommand(PHONE, '/reset-bot', `+${PHONE}`), true);
});

test('allowlist sin "+" y teléfono con "+" → normaliza y matchea', () => {
  assert.equal(isTestResetCommand(`+${PHONE}`, '/reset-bot', PHONE), true);
});

// ─── isTestPhoneAllowlisted aislada ───────────────────────────────────────────

test('isTestPhoneAllowlisted: número presente → true', () => {
  assert.equal(isTestPhoneAllowlisted(PHONE, ALLOWLIST), true);
});

test('isTestPhoneAllowlisted: número ausente → false', () => {
  assert.equal(isTestPhoneAllowlisted(OTHER, ALLOWLIST), false);
});

test('isTestPhoneAllowlisted: teléfono vacío → false', () => {
  assert.equal(isTestPhoneAllowlisted('', ALLOWLIST), false);
});

test('isTestPhoneAllowlisted: allowlist undefined → false', () => {
  assert.equal(isTestPhoneAllowlisted(PHONE, undefined), false);
});

// ─── Sanity: el trigger es el esperado ────────────────────────────────────────

test('TEST_RESET_TRIGGER es el esperado', () => {
  assert.equal(TEST_RESET_TRIGGER, '/reset-bot');
});
