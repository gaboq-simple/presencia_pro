// ─── Tests de viz (kit de gráficas del dueño) — matemática pura ───────────────
// Ancho de barra con piso visual, escalones de las dos rampas y el pliegue de la
// cola larga. Números conocidos, incluidos los casos del plan (dueno-v3, Paso 2).
//
// El archivo vive en tests/ (no en apps/lifestyle/tests/, que no existe): es el
// patrón de lib/pulso.ts que el propio plan cita, y es lo que `npm test` corre.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pctWidth,
  seqStep,
  huecoStep,
  foldOtros,
  MIN_VISIBLE_PCT,
  type VizRow,
} from '../apps/lifestyle/src/lib/viz';

// ─── pctWidth ─────────────────────────────────────────────────────────────────

test('pctWidth: los tres casos del plan (máximo, piso visual, cero real)', () => {
  assert.equal(pctWidth(388, 388), 100);   // el máximo de la serie llena la pista
  assert.equal(pctWidth(1, 388), 2);       // 0.26% → piso visual: existe, se ve
  assert.equal(pctWidth(0, 388), 0);       // cero real → cero ancho, sin piso
});

test('pctWidth: proporción normal, sin tocar el piso ni el techo', () => {
  assert.equal(pctWidth(194, 388), 50);
  assert.equal(pctWidth(97, 388), 25);
  assert.equal(pctWidth(291, 388), 75);
});

test('pctWidth: el piso se aplica hasta el último valor que redondearía a nada', () => {
  // Justo por debajo del piso → sube al piso; justo por encima → su valor real.
  assert.equal(pctWidth(7, 388), MIN_VISIBLE_PCT);        // 1.80% → 2
  assert.equal(pctWidth(9, 388), 2.32);                   // 2.32% → tal cual
});

test('pctWidth: nunca pasa de 100 aunque el valor supere el máximo', () => {
  assert.equal(pctWidth(500, 388), 100);
});

test('pctWidth: entradas degeneradas devuelven 0, no NaN ni Infinity', () => {
  assert.equal(pctWidth(10, 0), 0);          // máximo 0 (serie vacía)
  assert.equal(pctWidth(-5, 388), 0);        // negativo: no existe barra negativa
  assert.equal(pctWidth(Number.NaN, 388), 0);
  assert.equal(pctWidth(10, Number.NaN), 0);
  assert.equal(pctWidth(10, Number.POSITIVE_INFINITY), 0);
});

test('pctWidth: redondea a 2 decimales (el número va a un style inline)', () => {
  assert.equal(pctWidth(1, 3), 33.33);
});

// ─── seqStep (rampa de MAGNITUD, 7 escalones) ─────────────────────────────────

test('seqStep: los dos casos del plan (mínimo y casi lleno)', () => {
  assert.equal(seqStep(0), 1);
  assert.equal(seqStep(0.99), 7);
});

test('seqStep: reparte [0,1] en 7 cubetas de igual ancho', () => {
  assert.equal(seqStep(1 / 14), 1);        // dentro de la 1ª (0 – 1/7)
  assert.equal(seqStep(1 / 7), 2);         // borde: empieza la 2ª
  assert.equal(seqStep(0.5), 4);           // media → escalón central
  assert.equal(seqStep(6 / 7), 7);         // borde: empieza la última
});

test('seqStep: satura en 7 y nunca baja de 1 (fuera de rango o NaN)', () => {
  assert.equal(seqStep(1), 7);
  assert.equal(seqStep(3), 7);
  assert.equal(seqStep(-1), 1);
  assert.equal(seqStep(Number.NaN), 1);
});

// ─── huecoStep (rampa de HUECO, 4 escalones) ──────────────────────────────────

test('huecoStep: reparte [0,max] en 4 cubetas y satura en 4', () => {
  assert.equal(huecoStep(0, 8), 1);
  assert.equal(huecoStep(1, 8), 1);        // 12.5% → 1ª cubeta
  assert.equal(huecoStep(2, 8), 2);        // 25% → borde de la 2ª
  assert.equal(huecoStep(5, 8), 3);        // 62.5% → 3ª
  assert.equal(huecoStep(8, 8), 4);        // el máximo → el más marcado
  assert.equal(huecoStep(12, 8), 4);       // por encima del máximo: satura
});

test('huecoStep: máximo 0 o entradas inválidas → 1 (no pinta un token inexistente)', () => {
  assert.equal(huecoStep(3, 0), 1);
  assert.equal(huecoStep(Number.NaN, 8), 1);
  assert.equal(huecoStep(3, Number.NaN), 1);
  assert.equal(huecoStep(-3, 8), 1);
});

// ─── foldOtros (pliegue de la cola larga) ─────────────────────────────────────

const OCHO_SERVICIOS: VizRow[] = [
  { label: 'Corte de cabello', value: 45 },
  { label: 'Corte + barba', value: 22 },
  { label: 'Barba / afeitado clásico', value: 10 },
  { label: 'Corte premium', value: 7 },
  { label: 'Corte niño', value: 6 },
  { label: 'Tinte / color', value: 4 },
  { label: 'Tratamiento capilar', value: 3 },
  { label: 'Delineado', value: 3 },
];

test('foldOtros: el caso del plan — 8 servicios con tope 4 → 5 filas, la 5ª suma las otras 4', () => {
  const out = foldOtros(OCHO_SERVICIOS, 4);
  assert.equal(out.length, 5);
  assert.deepEqual(
    out.slice(0, 4).map((f) => f.label),
    ['Corte de cabello', 'Corte + barba', 'Barba / afeitado clásico', 'Corte premium'],
  );
  const otros = out[4]!;
  assert.equal(otros.label, 'Otros 4');
  assert.equal(otros.esOtros, true);
  assert.equal(otros.agrupadas, 4);
  assert.equal(otros.value, 6 + 4 + 3 + 3);
});

test('foldOtros: plegar CONSERVA la suma (no esconde)', () => {
  const total = OCHO_SERVICIOS.reduce((a, f) => a + f.value, 0);
  for (const tope of [1, 2, 3, 4, 5, 6, 7]) {
    const out = foldOtros(OCHO_SERVICIOS, tope);
    assert.equal(out.reduce((a, f) => a + f.value, 0), total, `tope ${tope}`);
  }
});

test('foldOtros: ordena descendente por valor aunque entren desordenadas', () => {
  const out = foldOtros([
    { label: 'chico', value: 1 },
    { label: 'grande', value: 100 },
    { label: 'medio', value: 50 },
  ], 3);
  assert.deepEqual(out.map((f) => f.label), ['grande', 'medio', 'chico']);
});

test('foldOtros: con tope o menos filas no inventa un "Otros 0"', () => {
  const tres = OCHO_SERVICIOS.slice(0, 3);
  const out = foldOtros(tres, 4);
  assert.equal(out.length, 3);
  assert.equal(out.some((f) => f.esOtros), false);

  const exacto = foldOtros(tres, 3);
  assert.equal(exacto.length, 3);
  assert.equal(exacto.some((f) => f.esOtros), false);
});

test('foldOtros: empates conservan el orden de entrada (salida determinista)', () => {
  const empatadas: VizRow[] = [
    { label: 'a', value: 5 }, { label: 'b', value: 5 }, { label: 'c', value: 5 },
  ];
  assert.deepEqual(foldOtros(empatadas, 3).map((f) => f.label), ['a', 'b', 'c']);
  assert.deepEqual(foldOtros(empatadas, 2).map((f) => f.label), ['a', 'b', 'Otros 1']);
});

test('foldOtros: tope degenerado (0 o negativo) se trata como 1, no revienta', () => {
  const out = foldOtros(OCHO_SERVICIOS, 0);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.label, 'Corte de cabello');
  assert.equal(out[1]!.label, 'Otros 7');
});

test('foldOtros: lista vacía → lista vacía', () => {
  assert.deepEqual(foldOtros([], 4), []);
});

test('foldOtros: no muta la lista de entrada', () => {
  const copia = OCHO_SERVICIOS.map((f) => ({ ...f }));
  foldOtros(OCHO_SERVICIOS, 3);
  assert.deepEqual(OCHO_SERVICIOS, copia);
});
