// ─── Tests del fondo de caja (S9-DIN-01) — validación pura ────────────────────
// El fondo es el piso contra el que se cuenta el cajón. Tuvo dos lectores y cero
// escritores desde que existe la capa de dinero, así que cada corte nacía con un
// descuadre positivo del tamaño exacto del fondo.
//
// Lo que se fija acá: vacío es CERO explícito (abrir sin cambio es legítimo),
// pero un texto que no es número NO se adivina como cero — un cero inventado
// vuelve a torcer el corte en silencio, que es el defecto que esto cierra.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveFondo, esFondoError, MAX_FONDO } from '../apps/lifestyle/src/lib/caja';

function ok(r: ReturnType<typeof resolveFondo>): number {
  assert.equal(esFondoError(r), false, `esperaba fondo válido, llegó ${JSON.stringify(r)}`);
  return r as number;
}

test('un monto normal pasa tal cual', () => {
  assert.equal(ok(resolveFondo(500)), 500);
  assert.equal(ok(resolveFondo('500')), 500);
});

test('vacío, null y undefined son CERO explícito — abrir sin cambio es legítimo', () => {
  assert.equal(ok(resolveFondo('')), 0);
  assert.equal(ok(resolveFondo('   ')), 0);
  assert.equal(ok(resolveFondo(null)), 0);
  assert.equal(ok(resolveFondo(undefined)), 0);
});

test('un texto que no es número NO se adivina como cero', () => {
  // Es la diferencia que importa: un cero inventado tuerce el corte en silencio,
  // igual que el default 0 que había antes de que el fondo tuviera escritor.
  const r = resolveFondo('quinientos');
  assert.equal(esFondoError(r), true);
  assert.equal((r as { error: string }).error, 'El fondo tiene que ser un número');
});

test('el fondo no puede ser negativo (la BD también lo rebota, con CHECK)', () => {
  const r = resolveFondo(-1);
  assert.equal(esFondoError(r), true);
  assert.match((r as { error: string }).error, /negativo/);
});

test('techo de cordura: un fondo es cambio para el día, no la caja fuerte', () => {
  assert.equal(ok(resolveFondo(MAX_FONDO)), MAX_FONDO);
  assert.equal(esFondoError(resolveFondo(MAX_FONDO + 1)), true);
});

test('acepta lo que una persona teclea de verdad: signo de pesos, comas, espacios', () => {
  assert.equal(ok(resolveFondo('$1,500')), 1500);
  assert.equal(ok(resolveFondo(' 1500 ')), 1500);
});

test('centavos exactos — la columna es numeric(10,2) y el float acumula ruido', () => {
  assert.equal(ok(resolveFondo(1500.005)), 1500.01);
  assert.equal(ok(resolveFondo('99.999')), 100);
});
