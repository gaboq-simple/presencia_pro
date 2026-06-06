// S4-BOT-04 — Tests del cableado de datos del negocio al bot.
// Puros y deterministas: sin red, sin Supabase, sin Anthropic.
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatServicePrice,
  buildMinisiteUrl,
  buildBusinessContext,
  answerSideQuestion,
} from '../packages/engine/src/bot/lifestyle/businessContext';
import { buildSystemPrompt } from '../packages/engine/src/bot/lifestyle/prompt';
import {
  APP_URL,
  business,
  minimalBusiness,
  catalog,
  serviceExact,
  serviceRange,
  serviceFromWithNote,
  serviceNoPrice,
} from './fixtures/lifestyle';

// ─── formatServicePrice ───────────────────────────────────────────────────────

test('formatServicePrice: precio exacto', () => {
  assert.equal(formatServicePrice(serviceExact), '$200');
});

test('formatServicePrice: rango min–max', () => {
  assert.equal(formatServicePrice(serviceRange), '$500 a $900');
});

test('formatServicePrice: solo min → "desde" + nota', () => {
  assert.equal(formatServicePrice(serviceFromWithNote), 'desde $120 según estilo');
});

test('formatServicePrice: sin info de precio → a consultar', () => {
  assert.equal(formatServicePrice(serviceNoPrice), 'precio a consultar');
});

test('formatServicePrice: min === max colapsa a un valor', () => {
  assert.equal(
    formatServicePrice({ ...serviceExact, price: 0, price_min: 300, price_max: 300 }),
    '$300',
  );
});

test('formatServicePrice: solo nota, sin número', () => {
  assert.equal(
    formatServicePrice({ ...serviceNoPrice, price_note: 'precio según evaluación' }),
    'precio según evaluación',
  );
});

// ─── buildMinisiteUrl ─────────────────────────────────────────────────────────

test('buildMinisiteUrl: arma URL con slug y appUrl', () => {
  assert.equal(buildMinisiteUrl(business, { appUrl: APP_URL }), `${APP_URL}/barberia-el-corte`);
});

test('buildMinisiteUrl: trailing slash en appUrl se normaliza', () => {
  assert.equal(buildMinisiteUrl(business, { appUrl: `${APP_URL}/` }), `${APP_URL}/barberia-el-corte`);
});

test('buildMinisiteUrl: null si falta slug', () => {
  assert.equal(buildMinisiteUrl(minimalBusiness, { appUrl: APP_URL }), null);
});

test('buildMinisiteUrl: null si falta appUrl', () => {
  assert.equal(buildMinisiteUrl(business), null);
});

// ─── buildBusinessContext ─────────────────────────────────────────────────────

test('buildBusinessContext: incluye tipo, dirección, mapa, horarios y servicios', () => {
  const ctx = buildBusinessContext(business, catalog, { appUrl: APP_URL });
  assert.match(ctx, /Tipo de negocio: barbería/);
  assert.match(ctx, /Dirección: Av\. Reforma 123, CDMX/);
  assert.match(ctx, /Mapa: https:\/\/maps\.google\.com/);
  assert.match(ctx, /Lunes: 09:00–18:00/);
  assert.match(ctx, /Corte clásico: \$200, 30 min/);
  assert.match(ctx, /Tinte: \$500 a \$900/);
});

test('buildBusinessContext: comodidades en true bajo "Comodidades"; false bajo "No cuenta con"', () => {
  const ctx = buildBusinessContext(business, catalog, { appUrl: APP_URL });
  assert.match(ctx, /Comodidades: .*acepta pago con tarjeta/);
  assert.match(ctx, /Comodidades: .*estacionamiento/);
  // wifi=false NO se omite (eso lo confundiría con dato ausente): se reporta como negativo.
  assert.doesNotMatch(ctx, /Comodidades: .*wifi/);
  assert.match(ctx, /No cuenta con: .*wifi/);
});

test('buildBusinessContext: omite "No cuenta con" cuando no hay banderas en false', () => {
  const ctx = buildBusinessContext(
    { ...business, attributes: { pays_card: true, parking: true } },
    catalog,
    { appUrl: APP_URL },
  );
  assert.doesNotMatch(ctx, /No cuenta con:/);
});

test('buildBusinessContext: incluye reseñas y link al minisite', () => {
  const ctx = buildBusinessContext(business, catalog, { appUrl: APP_URL });
  assert.match(ctx, /Reseñas: https:\/\/g\.page\/r\/review-el-corte/);
  assert.match(ctx, new RegExp(`Sitio del negocio: ${APP_URL}/barberia-el-corte`));
});

test('buildBusinessContext: omite secciones ausentes en negocio mínimo', () => {
  const ctx = buildBusinessContext(minimalBusiness, [], { appUrl: APP_URL });
  assert.doesNotMatch(ctx, /Mapa:/);
  assert.doesNotMatch(ctx, /Horarios:/);
  assert.doesNotMatch(ctx, /Comodidades:/);
  assert.doesNotMatch(ctx, /Reseñas:/);
  assert.doesNotMatch(ctx, /Sitio del negocio:/); // sin slug → sin minisite
});

// ─── answerSideQuestion ([DERIVA] fallback) ───────────────────────────────────

test('answerSideQuestion: topic=other deriva al minisite cuando existe', () => {
  const ans = answerSideQuestion('other', business, catalog, { appUrl: APP_URL });
  assert.match(ans, new RegExp(`${APP_URL}/barberia-el-corte`));
});

test('answerSideQuestion: deriva al equipo cuando no hay minisite', () => {
  const ans = answerSideQuestion('other', minimalBusiness, [], { appUrl: APP_URL });
  assert.equal(ans, 'Con gusto lo consulto con el equipo y te confirmo.');
});

test('answerSideQuestion: reviews sin reviewUrl → fallback minisite', () => {
  const ans = answerSideQuestion('reviews', minimalBusiness, [], { appUrl: APP_URL });
  assert.equal(ans, 'Con gusto lo consulto con el equipo y te confirmo.');
});

test('answerSideQuestion: price lista precios reales', () => {
  const ans = answerSideQuestion('price', business, catalog, { appUrl: APP_URL });
  assert.match(ans, /Corte clásico \$200/);
  assert.match(ans, /Tinte \$500 a \$900/);
});

test('answerSideQuestion: location incluye dirección y mapa', () => {
  const ans = answerSideQuestion('location', business, catalog, { appUrl: APP_URL });
  assert.match(ans, /Av\. Reforma 123/);
  assert.match(ans, /maps\.google\.com/);
});

// ─── Anti-regresión: el system prompt contiene los datos clave ────────────────
// Guarda contra una futura ruptura del cableado (el audit halló un "System
// Prompt v2" borrado sin que nadie lo notara por falta de tests).

test('buildSystemPrompt: el prompt contiene precio, horario, reseñas y link', () => {
  const prompt = buildSystemPrompt(business, undefined, catalog, { appUrl: APP_URL });
  assert.match(prompt, /\$200/);                                  // un precio real
  assert.match(prompt, /Lunes: 09:00–18:00/);                     // horario real
  assert.match(prompt, /review-el-corte/);                        // reviewUrl real
  assert.match(prompt, new RegExp(`${APP_URL}/barberia-el-corte`)); // minisite
  assert.match(prompt, /barbería/);                               // business_type real
  assert.doesNotMatch(prompt, /negocio de bienestar y estética/); // hardcode eliminado
});
