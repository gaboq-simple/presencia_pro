// ─── La regla de supresión del despachador, y su gemela del engine ────────────
// El despachador corre en Deno y NO comparte el paquete del engine, así que la
// regla de "a quién no se le escribe" existe DOS VECES: en
// `apps/lifestyle/src/lib/optOutLookup.ts` (la del engine) y en
// `supabase/functions/dispatch-lifestyle-notifications/supresion.ts` (la de Deno).
//
// Dos copias de una regla se separan; es cuestión de tiempo. Y el día que se
// separen, el que se despliega es el de Deno — o sea que el agujero aparecería
// justo donde nadie mira. Este archivo hace dos cosas: fija el comportamiento de
// la copia que se despliega, y COMPARA las dos para que separarlas rompa el build.
//
// El import por ruta relativa no es un truco: `supresion.ts` es puro y sin
// imports precisamente para que la suite pruebe el mismo archivo que viaja en el
// bundle de la function.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  decidirEnvio,
  motivoDeSupresion,
  esProactivo,
  TIPOS_PROACTIVOS,
} from '../supabase/functions/dispatch-lifestyle-notifications/supresion';

const CONSENTIDO = { opted_out_at: null, consent_at: '2026-01-01T00:00:00Z', consented_via: 'whatsapp_first_message' };

// ─── Qué se suprime y qué no ──────────────────────────────────────────────────

test('los dos proactivos son review_request y reactivation, y nadie más', () => {
  assert.deepEqual([...TIPOS_PROACTIVOS].sort(), ['reactivation', 'review_request']);
});

test('los siete de utilidad NO se suprimen, ni siquiera para un cliente dado de baja', () => {
  // Es la regla de niveles: son de una cita que el propio cliente agendó. No
  // dárselos es peor servicio, no más privacidad.
  const dadoDeBaja = { ...CONSENTIDO, opted_out_at: '2026-08-01T00:00:00Z' };
  for (const tipo of ['reminder_24h', 'reminder_2h', 'reminder_1h', 'follow_up',
                      'waitlist_expiry', 'reschedule_notice', 'cancellation_notice']) {
    assert.equal(esProactivo(tipo), false, `${tipo} no debería ser proactivo`);
    assert.deepEqual(decidirEnvio(tipo, dadoDeBaja), { enviar: true }, `${tipo} no se suprime`);
  }
});

test('un proactivo a alguien dado de baja se suprime, con su motivo', () => {
  const r = decidirEnvio('reactivation', { ...CONSENTIDO, opted_out_at: '2026-08-01T00:00:00Z' });
  assert.deepEqual(r, { enviar: false, motivo: 'el titular se dio de baja' });
});

test('un proactivo a alguien que nunca vio el aviso se suprime, y el motivo es OTRO', () => {
  // Los dos motivos se arreglan de maneras opuestas: una baja se respeta para
  // siempre; el aviso se resuelve la primera vez que el cliente escribe al bot.
  const pendiente = { opted_out_at: null, consent_at: '2026-01-01T00:00:00Z', consented_via: 'pending_notice' };
  const sinConsentAt = { opted_out_at: null, consent_at: null, consented_via: 'import' };
  const esperado = { enviar: false, motivo: 'el titular todavía no vio el aviso de privacidad' };
  assert.deepEqual(decidirEnvio('review_request', pendiente), esperado);
  assert.deepEqual(decidirEnvio('review_request', sinConsentAt), esperado);
});

test('un proactivo a alguien que SÍ consintió sale (control positivo)', () => {
  assert.deepEqual(decidirEnvio('reactivation', CONSENTIDO), { enviar: true });
});

test('un teléfono sin fila NO está dado de baja', () => {
  assert.equal(motivoDeSupresion(null), null);
  assert.deepEqual(decidirEnvio('reactivation', null), { enviar: true });
});

test('falla CERRADO: si no se pudo comprobar la baja, no se manda', () => {
  const r = decidirEnvio('reactivation', CONSENTIDO, true);
  assert.deepEqual(r, { enviar: false, motivo: 'no se pudo comprobar la baja' });
});

// ─── El candado: las dos copias no se pueden separar ─────────────────────────

test('la regla de Deno dice lo mismo que la del engine, motivo por motivo', () => {
  // `optOutLookup.ts` no se puede importar acá (arrastra supabase-js y `@/`),
  // así que se comparan sus TEXTOS: los dos motivos y las dos condiciones tienen
  // que aparecer literales en los dos archivos.
  const engine = readFileSync('apps/lifestyle/src/lib/optOutLookup.ts', 'utf8');
  const deno   = readFileSync('supabase/functions/dispatch-lifestyle-notifications/supresion.ts', 'utf8');

  for (const literal of [
    'el titular se dio de baja',
    'el titular todavía no vio el aviso de privacidad',
    "consented_via === 'pending_notice'",
    'consent_at === null',
    'opted_out_at !== null',
  ]) {
    assert.ok(engine.includes(literal), `el engine perdió: ${literal}`);
    assert.ok(deno.includes(literal),   `la copia de Deno perdió: ${literal}`);
  }
});

// ─── Contraprueba: el candado tiene que poder fallar ──────────────────────────

test('CONTRAPRUEBA — el comportamiento viejo (mandar sin mirar) sería detectado', () => {
  // Así se comportaba el despachador antes de este paso: despachaba los nueve
  // tipos sin consultar nada.
  const comoAntes = () => ({ enviar: true as const });

  const dadoDeBaja = { ...CONSENTIDO, opted_out_at: '2026-08-01T00:00:00Z' };
  assert.equal(comoAntes().enviar, true, 'el doble tiene que reproducir el defecto');
  assert.equal(decidirEnvio('reactivation', dadoDeBaja).enviar, false);
  assert.notEqual(decidirEnvio('reactivation', dadoDeBaja).enviar, comoAntes().enviar);
});
