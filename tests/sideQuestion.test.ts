// S4-BOT-07 — Tests del catálogo de side-questions [FIJO]/[DERIVA].
// Puros y deterministas: sin red, sin Supabase, sin Anthropic.
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatOfficeHoursNatural,
  paymentForms,
  refineTopic,
  resolveTargetService,
  routeSideQuestion,
  derivaFallback,
  answerSideQuestionDeterministic,
  composeGreetingSideAnswer,
  MISSING_DATA_ANSWER,
} from '../packages/engine/src/bot/lifestyle/sideQuestion';
import type { LifestyleBusinessConfig } from '../packages/engine/src/bot/lifestyle/types';
import {
  APP_URL,
  business,
  minimalBusiness,
  catalog,
  serviceExact,
  serviceRange,
} from './fixtures/lifestyle';

const OPTS = { appUrl: APP_URL };

// ─── formatOfficeHoursNatural ─────────────────────────────────────────────────

test('formatOfficeHoursNatural: agrupa lunes-viernes y sábados (ejemplo del prompt)', () => {
  const oh = {
    '1': { start: '10:00', end: '20:00' },
    '2': { start: '10:00', end: '20:00' },
    '3': { start: '10:00', end: '20:00' },
    '4': { start: '10:00', end: '20:00' },
    '5': { start: '10:00', end: '20:00' },
    '6': { start: '10:00', end: '18:00' },
    '0': null,
  };
  assert.equal(
    formatOfficeHoursNatural(oh),
    'de lunes a viernes de 10:00 a 20:00, y sábados de 10:00 a 18:00',
  );
});

test('formatOfficeHoursNatural: fixture business (lunes-martes + sábados)', () => {
  assert.equal(
    formatOfficeHoursNatural(business.officeHours),
    'de lunes a martes de 09:00 a 18:00, y sábados de 10:00 a 14:00',
  );
});

test('formatOfficeHoursNatural: un solo día usa forma plural', () => {
  assert.equal(
    formatOfficeHoursNatural({ '6': { start: '10:00', end: '14:00' } }),
    'sábados de 10:00 a 14:00',
  );
});

test('formatOfficeHoursNatural: toda la semana mismo horario → rango completo', () => {
  const oh: Record<string, { start: string; end: string }> = {};
  for (const d of ['1', '2', '3', '4', '5', '6', '0']) oh[d] = { start: '10:00', end: '20:00' };
  assert.equal(formatOfficeHoursNatural(oh), 'de lunes a domingo de 10:00 a 20:00');
});

test('formatOfficeHoursNatural: sin horarios → vacío', () => {
  assert.equal(formatOfficeHoursNatural(null), '');
  assert.equal(formatOfficeHoursNatural({}), '');
});

// ─── paymentForms (GAP 3) ─────────────────────────────────────────────────────

test('paymentForms: las tres formas en orden', () => {
  assert.deepEqual(
    paymentForms({ pays_cash: true, pays_card: true, pays_transfer: true }),
    ['efectivo', 'tarjeta', 'transferencia'],
  );
});

test('paymentForms: solo tarjeta', () => {
  assert.deepEqual(paymentForms({ pays_card: true }), ['tarjeta']);
});

test('paymentForms: sin banderas de pago → vacío', () => {
  assert.deepEqual(paymentForms({ parking: true }), []);
  assert.deepEqual(paymentForms(null), []);
});

// ─── refineTopic ──────────────────────────────────────────────────────────────

test('refineTopic: detecta payment/kids/parking/reviews por keyword', () => {
  assert.equal(refineTopic('other', '¿aceptan tarjeta?'), 'payment');
  assert.equal(refineTopic('other', 'puedo pagar en efectivo'), 'payment');
  assert.equal(refineTopic('other', '¿atienden niños?'), 'kids');
  assert.equal(refineTopic('other', '¿hay estacionamiento?'), 'parking');
  assert.equal(refineTopic('other', 'quiero dejar una reseña'), 'reviews');
});

test('refineTopic: confía topics base deterministas', () => {
  assert.equal(refineTopic('price', '¿cuánto cuesta el corte?'), 'price');
  assert.equal(refineTopic('hours', '¿a qué hora abren?'), 'hours');
  assert.equal(refineTopic('location', '¿dónde están?'), 'location');
});

test('refineTopic: other sube a services o se queda en other', () => {
  assert.equal(refineTopic('other', '¿qué servicios ofrecen?'), 'services');
  assert.equal(refineTopic('other', '¿venden productos para la barba?'), 'other');
});

// ─── resolveTargetService ─────────────────────────────────────────────────────

test('resolveTargetService: único servicio se usa siempre', () => {
  assert.equal(resolveTargetService('lo que sea', [serviceExact]), serviceExact);
});

test('resolveTargetService: empareja por nombre en la pregunta', () => {
  assert.equal(resolveTargetService('cuánto cuesta el Corte clásico', catalog), serviceExact);
});

test('resolveTargetService: ambiguo → null', () => {
  assert.equal(resolveTargetService('cuánto cuesta', catalog), null);
});

// ─── routeSideQuestion: plantillas deterministas ──────────────────────────────

test('routeSideQuestion: ubicación con mapa', () => {
  const r = routeSideQuestion({ topic: 'location', question: '¿dónde están?', business, services: catalog, opts: OPTS });
  assert.deepEqual(r, {
    mode: 'answer',
    text: 'Estamos en Av. Reforma 123, CDMX. Aquí te dejo el mapa: https://maps.google.com/?q=el-corte',
  });
});

test('routeSideQuestion: ubicación sin mapa', () => {
  const biz: LifestyleBusinessConfig = { ...business, mapUrl: undefined };
  const r = routeSideQuestion({ topic: 'location', question: '¿dónde están?', business: biz, services: catalog, opts: OPTS });
  assert.deepEqual(r, { mode: 'answer', text: 'Estamos en Av. Reforma 123, CDMX.' });
});

test('routeSideQuestion: horarios formateados', () => {
  const r = routeSideQuestion({ topic: 'hours', question: '¿a qué hora abren?', business, services: catalog, opts: OPTS });
  assert.deepEqual(r, {
    mode: 'answer',
    text: 'Abrimos de lunes a martes de 09:00 a 18:00, y sábados de 10:00 a 14:00.',
  });
});

test('routeSideQuestion: precio exacto', () => {
  const r = routeSideQuestion({ topic: 'price', question: '¿cuánto cuesta?', business, services: [serviceExact], opts: OPTS });
  assert.deepEqual(r, { mode: 'answer', text: 'El Corte clásico sale en $200.' });
});

test('routeSideQuestion: precio en rango → defer (Haiku)', () => {
  const r = routeSideQuestion({ topic: 'price', question: '¿cuánto cuesta el tinte?', business, services: [serviceRange], opts: OPTS });
  assert.deepEqual(r, { mode: 'defer' });
});

test('routeSideQuestion: duración', () => {
  const r = routeSideQuestion({ topic: 'duration', question: '¿cuánto dura?', business, services: [serviceExact], opts: OPTS });
  assert.deepEqual(r, { mode: 'answer', text: 'El Corte clásico toma unos 30 minutos.' });
});

test('routeSideQuestion: servicios', () => {
  const r = routeSideQuestion({ topic: 'other', question: '¿qué servicios ofrecen?', business, services: catalog, opts: OPTS });
  assert.deepEqual(r, { mode: 'answer', text: 'Manejamos: Corte clásico, Tinte, Barba.' });
});

// ─── routeSideQuestion: banderas (true/false) ─────────────────────────────────

test('routeSideQuestion: formas de pago habilitadas', () => {
  const biz: LifestyleBusinessConfig = { ...business, attributes: { pays_cash: true, pays_card: true, pays_transfer: true } };
  const r = routeSideQuestion({ topic: 'other', question: '¿cómo puedo pagar?', business: biz, services: catalog, opts: OPTS });
  assert.deepEqual(r, { mode: 'answer', text: 'Aceptamos efectivo, tarjeta y transferencia.' });
});

test('routeSideQuestion: una sola forma de pago', () => {
  const r = routeSideQuestion({ topic: 'other', question: '¿aceptan tarjeta?', business, services: catalog, opts: OPTS });
  assert.deepEqual(r, { mode: 'answer', text: 'Aceptamos tarjeta.' });
});

test('routeSideQuestion: niños true / false', () => {
  const yes: LifestyleBusinessConfig = { ...business, attributes: { kids_friendly: true } };
  const no: LifestyleBusinessConfig  = { ...business, attributes: { kids_friendly: false } };
  assert.equal(routeSideQuestion({ topic: 'other', question: '¿atienden niños?', business: yes, services: catalog, opts: OPTS }).text, 'Sí, atendemos niños.');
  assert.equal(routeSideQuestion({ topic: 'other', question: '¿atienden niños?', business: no, services: catalog, opts: OPTS }).text, 'Por ahora solo atendemos adultos.');
});

test('routeSideQuestion: estacionamiento true / false', () => {
  const no: LifestyleBusinessConfig = { ...business, attributes: { parking: false } };
  assert.equal(routeSideQuestion({ topic: 'other', question: '¿hay estacionamiento?', business, services: catalog, opts: OPTS }).text, 'Sí, contamos con estacionamiento.');
  assert.equal(routeSideQuestion({ topic: 'other', question: '¿hay estacionamiento?', business: no, services: catalog, opts: OPTS }).text, 'No contamos con estacionamiento.');
});

test('routeSideQuestion: reseñas con review_url (excepción de tono)', () => {
  const r = routeSideQuestion({ topic: 'other', question: 'quiero dejar una reseña', business, services: catalog, opts: OPTS });
  assert.deepEqual(r, {
    mode: 'answer',
    text: 'Lamento que no haya sido la mejor experiencia. Puedes dejarnos tu opinión aquí para que el equipo la vea: https://g.page/r/review-el-corte',
  });
});

test('routeSideQuestion: reseñas sin review_url → minisite con tacto', () => {
  const biz: LifestyleBusinessConfig = { ...business, reviewUrl: undefined };
  const r = routeSideQuestion({ topic: 'other', question: 'tengo una queja', business: biz, services: catalog, opts: OPTS });
  assert.deepEqual(r, {
    mode: 'answer',
    text: `Lamento que no haya sido la mejor experiencia. Cuéntanos más aquí: ${APP_URL}/barberia-el-corte`,
  });
});

test('routeSideQuestion: reseñas sin review_url ni minisite → derivación honesta', () => {
  const r = routeSideQuestion({ topic: 'other', question: 'una queja', business: minimalBusiness, services: [], opts: OPTS });
  assert.deepEqual(r, {
    mode: 'answer',
    text: 'Lamento que no haya sido la mejor experiencia. Escríbenos y con gusto lo revisamos con el equipo.',
  });
});

// ─── Regla de dato faltante ───────────────────────────────────────────────────

test('regla dato faltante: bandera de pago sin dato → respuesta honesta (NO minisite)', () => {
  const biz: LifestyleBusinessConfig = { ...business, attributes: { parking: true } }; // sin pays_*
  const r = routeSideQuestion({ topic: 'other', question: '¿puedo pagar con transferencia?', business: biz, services: catalog, opts: OPTS });
  assert.deepEqual(r, { mode: 'answer', text: MISSING_DATA_ANSWER });
  assert.doesNotMatch(r.text, /presenciapro/);
});

test('regla dato faltante: niños/estacionamiento sin dato → respuesta honesta', () => {
  const biz: LifestyleBusinessConfig = { ...business, attributes: {} };
  assert.equal(routeSideQuestion({ topic: 'other', question: '¿atienden niños?', business: biz, services: catalog, opts: OPTS }).text, MISSING_DATA_ANSWER);
  assert.equal(routeSideQuestion({ topic: 'other', question: '¿hay estacionamiento?', business: biz, services: catalog, opts: OPTS }).text, MISSING_DATA_ANSWER);
});

test('regla dato faltante: [DERIVA] real (productos) → minisite', () => {
  const ans = answerSideQuestionDeterministic('¿venden productos para barba?', business, catalog, OPTS);
  assert.equal(ans, `Eso lo puedes ver aquí: ${APP_URL}/barberia-el-corte`);
});

// ─── Enrutador: deterministic vs defer ────────────────────────────────────────

test('enrutador: topic other genérico → defer', () => {
  assert.deepEqual(
    routeSideQuestion({ topic: 'other', question: '¿venden productos?', business, services: catalog, opts: OPTS }),
    { mode: 'defer' },
  );
});

test('enrutador: dato ausente (horarios/ubicación) → defer', () => {
  assert.deepEqual(routeSideQuestion({ topic: 'hours', question: '¿abren?', business: minimalBusiness, services: [], opts: OPTS }), { mode: 'defer' });
  assert.deepEqual(routeSideQuestion({ topic: 'location', question: '¿dónde?', business: minimalBusiness, services: [], opts: OPTS }), { mode: 'defer' });
});

// ─── derivaFallback ───────────────────────────────────────────────────────────

test('derivaFallback: minisite si existe, si no derivación al equipo', () => {
  assert.equal(derivaFallback(business, OPTS), `Eso lo puedes ver aquí: ${APP_URL}/barberia-el-corte`);
  assert.equal(derivaFallback(minimalBusiness, OPTS), 'Con gusto lo consultamos con el equipo y te confirmamos.');
});

// ─── answerSideQuestionDeterministic (mid-flow, GAP 2) ────────────────────────

test('answerSideQuestionDeterministic: bandera honesta funciona mid-flow', () => {
  const biz: LifestyleBusinessConfig = { ...business, attributes: {} };
  assert.equal(answerSideQuestionDeterministic('¿aceptan transferencia?', biz, catalog, OPTS), MISSING_DATA_ANSWER);
});

test('answerSideQuestionDeterministic: servicios por keyword funciona mid-flow', () => {
  assert.equal(
    answerSideQuestionDeterministic('¿qué servicios ofrecen?', business, catalog, OPTS),
    'Manejamos: Corte clásico, Tinte, Barba.',
  );
});

test('answerSideQuestionDeterministic: pregunta no determinista → [DERIVA] minisite', () => {
  assert.equal(
    answerSideQuestionDeterministic('cuánto cuesta el Corte clásico', business, catalog, OPTS),
    `Eso lo puedes ver aquí: ${APP_URL}/barberia-el-corte`,
  );
});

// ─── GREETING (GAP 1) ─────────────────────────────────────────────────────────

test('composeGreetingSideAnswer: cliente nuevo → saludo breve + respuesta + invitación', () => {
  const out = composeGreetingSideAnswer({
    answer: 'El Corte clásico sale en $200.',
    isReturning: false,
    customerName: null,
    botName: 'Zlot',
    businessName: 'Barbería El Corte',
    hasHistory: false,
  });
  assert.equal(out, 'Hola, soy Zlot de Barbería El Corte. El Corte clásico sale en $200.\n¿Te gustaría agendar una cita?');
});

test('composeGreetingSideAnswer: cliente recurrente saluda por nombre', () => {
  const out = composeGreetingSideAnswer({
    answer: 'Abrimos de lunes a viernes de 10:00 a 20:00.',
    isReturning: true,
    customerName: 'Juan',
    botName: 'Zlot',
    businessName: 'Barbería El Corte',
    hasHistory: false,
  });
  assert.match(out, /^Hola Juan\. Abrimos/);
});

test('composeGreetingSideAnswer: con historial responde directo sin re-saludar', () => {
  const out = composeGreetingSideAnswer({
    answer: 'Aceptamos tarjeta.',
    isReturning: true,
    customerName: 'Juan',
    botName: 'Zlot',
    businessName: 'Barbería El Corte',
    hasHistory: true,
  });
  assert.equal(out, 'Aceptamos tarjeta.\n¿Te gustaría agendar una cita?');
  assert.doesNotMatch(out, /Hola/);
});

test('GREETING: side-question como primer mensaje responde el dato, no saludo genérico', () => {
  // El router resuelve la pregunta de forma determinista (no defer) y la
  // composición la antepone al saludo → el primer mensaje "¿cuánto cuesta?" NO
  // cae en un saludo genérico vacío.
  const route = routeSideQuestion({ topic: 'price', question: '¿cuánto cuesta?', business, services: [serviceExact], opts: OPTS });
  assert.equal(route.mode, 'answer');
  const out = composeGreetingSideAnswer({
    answer: route.mode === 'answer' ? route.text : '',
    isReturning: false,
    customerName: null,
    botName: 'Zlot',
    businessName: 'Barbería El Corte',
    hasHistory: false,
  });
  assert.match(out, /El Corte clásico sale en \$200\./);
});
