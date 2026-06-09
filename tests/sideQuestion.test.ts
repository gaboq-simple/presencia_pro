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
  isServiceOrPriceQuestion,
  closingLevelForTopic,
  closingForTopic,
  SIDE_QUESTION_INVITE,
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

test('routeSideQuestion: ubicación con mapa (link en línea propia + cierre neutro)', () => {
  const r = routeSideQuestion({ topic: 'location', question: '¿dónde están?', business, services: catalog, opts: OPTS });
  assert.deepEqual(r, {
    mode: 'answer',
    text: 'Estamos en Av. Reforma 123, CDMX.\nhttps://maps.google.com/?q=el-corte\nAquí te esperamos.',
  });
});

test('routeSideQuestion: ubicación sin mapa (cierre neutro, sin agenda)', () => {
  const biz: LifestyleBusinessConfig = { ...business, mapUrl: undefined };
  const r = routeSideQuestion({ topic: 'location', question: '¿dónde están?', business: biz, services: catalog, opts: OPTS });
  assert.deepEqual(r, { mode: 'answer', text: 'Estamos en Av. Reforma 123, CDMX.\nAquí te esperamos.' });
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

test('routeSideQuestion: reseñas con review_url (link en línea propia, sin agenda)', () => {
  const r = routeSideQuestion({ topic: 'other', question: 'quiero dejar una reseña', business, services: catalog, opts: OPTS });
  assert.deepEqual(r, {
    mode: 'answer',
    text: 'Lamento que no haya sido la mejor experiencia. Puedes dejarnos tu opinión aquí:\nhttps://g.page/r/review-el-corte',
  });
});

test('routeSideQuestion: reseñas sin review_url → minisite con tacto (link en línea propia)', () => {
  const biz: LifestyleBusinessConfig = { ...business, reviewUrl: undefined };
  const r = routeSideQuestion({ topic: 'other', question: 'tengo una queja', business: biz, services: catalog, opts: OPTS });
  assert.deepEqual(r, {
    mode: 'answer',
    text: `Lamento que no haya sido la mejor experiencia. Cuéntanos más aquí:\n${APP_URL}/barberia-el-corte`,
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

// ─── Bug de mapeo: bandera presente-en-false ≠ dato ausente (S4-BOT-07 polish) ─

test('bandera false NO es ausente: parking=false → negativa, no honesta', () => {
  const no: LifestyleBusinessConfig = { ...business, attributes: { parking: false } };
  const r = routeSideQuestion({ topic: 'other', question: '¿hay estacionamiento?', business: no, services: catalog, opts: OPTS });
  assert.equal(r.text, 'No contamos con estacionamiento.');
  assert.notEqual(r.text, MISSING_DATA_ANSWER);
});

test('bandera false NO es ausente: kids_friendly=false → negativa, no honesta', () => {
  const no: LifestyleBusinessConfig = { ...business, attributes: { kids_friendly: false } };
  const r = routeSideQuestion({ topic: 'other', question: '¿atienden niños?', business: no, services: catalog, opts: OPTS });
  assert.equal(r.text, 'Por ahora solo atendemos adultos.');
  assert.notEqual(r.text, MISSING_DATA_ANSWER);
});

test('pago: banderas presentes-en-false → negativa real, NO dato faltante', () => {
  const biz: LifestyleBusinessConfig = { ...business, attributes: { pays_cash: false, pays_card: false, pays_transfer: false } };
  const r = routeSideQuestion({ topic: 'other', question: '¿aceptan tarjeta?', business: biz, services: catalog, opts: OPTS });
  assert.equal(r.text, 'Por el momento no aceptamos efectivo, tarjeta y transferencia.');
  assert.notEqual(r.text, MISSING_DATA_ANSWER);
});

test('pago: una bandera en true entre falses → afirmativa de la habilitada', () => {
  const biz: LifestyleBusinessConfig = { ...business, attributes: { pays_cash: true, pays_card: false } };
  const r = routeSideQuestion({ topic: 'other', question: '¿cómo puedo pagar?', business: biz, services: catalog, opts: OPTS });
  assert.equal(r.text, 'Aceptamos efectivo.');
});

test('pago: banderas de pago AUSENTES → respuesta honesta (dato faltante)', () => {
  const biz: LifestyleBusinessConfig = { ...business, attributes: { parking: true } };
  const r = routeSideQuestion({ topic: 'other', question: '¿aceptan transferencia?', business: biz, services: catalog, opts: OPTS });
  assert.equal(r.text, MISSING_DATA_ANSWER);
});

// ─── Pertinencia del menú de servicios (S4-BOT-07 polish #3) ──────────────────

test('isServiceOrPriceQuestion: true para preguntas de servicios/precio', () => {
  assert.equal(isServiceOrPriceQuestion('¿qué servicios ofrecen?'), true);
  assert.equal(isServiceOrPriceQuestion('¿cuánto cuesta el corte?'), true);
  assert.equal(isServiceOrPriceQuestion('¿cuál es el precio?'), true);
  assert.equal(isServiceOrPriceQuestion('¿manejan tinte?'), true);
});

test('isServiceOrPriceQuestion: false para ubicación/horario/pago/niños/estacionamiento/reseñas', () => {
  assert.equal(isServiceOrPriceQuestion('¿dónde están ubicados?'), false);
  assert.equal(isServiceOrPriceQuestion('¿a qué hora abren?'), false);
  assert.equal(isServiceOrPriceQuestion('¿aceptan tarjeta?'), false);
  assert.equal(isServiceOrPriceQuestion('¿atienden niños?'), false);
  assert.equal(isServiceOrPriceQuestion('¿hay estacionamiento?'), false);
  assert.equal(isServiceOrPriceQuestion('quiero dejar una reseña'), false);
});

test('regla dato faltante: [DERIVA] real (productos) → minisite (link en línea propia)', () => {
  const ans = answerSideQuestionDeterministic('¿venden productos para barba?', business, catalog, OPTS);
  assert.equal(ans, `Eso lo puedes ver aquí:\n${APP_URL}/barberia-el-corte`);
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

test('derivaFallback: minisite si existe (link en línea propia), si no derivación al equipo', () => {
  assert.equal(derivaFallback(business, OPTS), `Eso lo puedes ver aquí:\n${APP_URL}/barberia-el-corte`);
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
    `Eso lo puedes ver aquí:\n${APP_URL}/barberia-el-corte`,
  );
});

// ─── GREETING (GAP 1) ─────────────────────────────────────────────────────────

test('composeGreetingSideAnswer: Nivel 1 (precio) → saludo breve + respuesta + invitación', () => {
  const out = composeGreetingSideAnswer({
    answer: 'El Corte clásico sale en $200.',
    closing: closingForTopic('price'),
    isReturning: false,
    customerName: null,
    botName: 'Zlot',
    businessName: 'Barbería El Corte',
    hasHistory: false,
  });
  assert.equal(out, 'Hola, soy Zlot de Barbería El Corte. El Corte clásico sale en $200.\n¿Te gustaría agendar?');
});

test('composeGreetingSideAnswer: Nivel 2 (horarios) cliente recurrente → sin empuje de agenda', () => {
  const out = composeGreetingSideAnswer({
    answer: 'Abrimos de lunes a viernes de 10:00 a 20:00.',
    closing: closingForTopic('hours'),
    isReturning: true,
    customerName: 'Juan',
    botName: 'Zlot',
    businessName: 'Barbería El Corte',
    hasHistory: false,
  });
  assert.match(out, /^Hola Juan\. Abrimos/);
  assert.doesNotMatch(out, /agendar/);
});

test('composeGreetingSideAnswer: Nivel 2 (pago) con historial → dato limpio, sin invitación', () => {
  const out = composeGreetingSideAnswer({
    answer: 'Aceptamos tarjeta.',
    closing: closingForTopic('payment'),
    isReturning: true,
    customerName: 'Juan',
    botName: 'Zlot',
    businessName: 'Barbería El Corte',
    hasHistory: true,
  });
  assert.equal(out, 'Aceptamos tarjeta.');
  assert.doesNotMatch(out, /Hola/);
  assert.doesNotMatch(out, /agendar/);
});

test('GREETING: side-question como primer mensaje responde el dato, no saludo genérico', () => {
  // El router resuelve la pregunta de forma determinista (no defer) y la
  // composición la antepone al saludo → el primer mensaje "¿cuánto cuesta?" NO
  // cae en un saludo genérico vacío.
  const route = routeSideQuestion({ topic: 'price', question: '¿cuánto cuesta?', business, services: [serviceExact], opts: OPTS });
  assert.equal(route.mode, 'answer');
  const out = composeGreetingSideAnswer({
    answer: route.mode === 'answer' ? route.text : '',
    closing: closingForTopic('price'),
    isReturning: false,
    customerName: null,
    botName: 'Zlot',
    businessName: 'Barbería El Corte',
    hasHistory: false,
  });
  assert.match(out, /El Corte clásico sale en \$200\./);
});

// ─── Cierre adaptativo por nivel (S4-BOT-08) ──────────────────────────────────

test('closingLevelForTopic: mapeo de cada topic a su nivel', () => {
  // Nivel 1 — intención de servicio
  assert.equal(closingLevelForTopic('price'), 1);
  assert.equal(closingLevelForTopic('duration'), 1);
  assert.equal(closingLevelForTopic('services'), 1);
  // Nivel 2 — logística
  assert.equal(closingLevelForTopic('location'), 2);
  assert.equal(closingLevelForTopic('hours'), 2);
  assert.equal(closingLevelForTopic('parking'), 2);
  assert.equal(closingLevelForTopic('payment'), 2);
  assert.equal(closingLevelForTopic('kids'), 2);
  // Nivel 3 — sin intención de cita ahora
  assert.equal(closingLevelForTopic('reviews'), 3);
  assert.equal(closingLevelForTopic('other'), 3);
});

test('closingForTopic: solo Nivel 1 invita a agendar', () => {
  assert.equal(closingForTopic('price'), SIDE_QUESTION_INVITE);
  assert.equal(closingForTopic('duration'), SIDE_QUESTION_INVITE);
  assert.equal(closingForTopic('services'), SIDE_QUESTION_INVITE);
  // Niveles 2 y 3 no anexan empuje de agenda
  for (const t of ['location', 'hours', 'parking', 'payment', 'kids', 'reviews', 'other'] as const) {
    assert.equal(closingForTopic(t), '');
  }
});

test('Nivel 1: respuesta invita a agendar con UNA sola pregunta', () => {
  const out = composeGreetingSideAnswer({
    answer: 'El Corte clásico sale en $200.',
    closing: closingForTopic('price'),
    isReturning: true, customerName: 'Ana', botName: 'Zlot', businessName: 'X', hasHistory: true,
  });
  assert.equal(out, 'El Corte clásico sale en $200.\n¿Te gustaría agendar?');
  assert.equal((out.match(/\?/g) ?? []).length, 1);
});

test('Nivel 2: logística → dato limpio, sin pregunta de agenda', () => {
  const r = routeSideQuestion({ topic: 'other', question: '¿hay estacionamiento?', business, services: catalog, opts: OPTS });
  const answer = r.mode === 'answer' ? r.text : '';
  const closing = closingForTopic(refineTopic('other', '¿hay estacionamiento?'));
  const out = closing ? `${answer}\n${closing}` : answer;
  assert.equal(out, 'Sí, contamos con estacionamiento.');
  assert.doesNotMatch(out, /agendar/);
});

test('Nivel 3: reseñas/productos → salida útil con link, sin agenda', () => {
  const reviews = routeSideQuestion({ topic: 'other', question: 'quiero dejar una reseña', business, services: catalog, opts: OPTS });
  assert.match(reviews.mode === 'answer' ? reviews.text : '', /\nhttps:\/\/g\.page/);
  assert.doesNotMatch(reviews.mode === 'answer' ? reviews.text : '', /agendar/);

  const products = answerSideQuestionDeterministic('¿venden productos?', business, catalog, OPTS);
  assert.match(products, /Eso lo puedes ver aquí:\n/);
  assert.doesNotMatch(products, /agendar/);
});

test('regla transversal: links siempre en su propia línea (salto antes del URL)', () => {
  // El URL nunca debe ir pegado a media frase: siempre precedido por un salto.
  const loc = routeSideQuestion({ topic: 'location', question: '¿dónde?', business, services: catalog, opts: OPTS });
  const locText = loc.mode === 'answer' ? loc.text : '';
  assert.doesNotMatch(locText, /[^\n]https?:\/\//); // ningún URL pegado a un caracter no-salto
  assert.match(locText, /\nhttps:\/\/maps/);
});

test('regla transversal: nunca dos preguntas en una respuesta de side-question', () => {
  // Nivel 1 (máximo 1 pregunta) y Niveles 2/3 (0 preguntas de agenda).
  const samples: Array<[string, string]> = [
    ['price', 'El Corte clásico sale en $200.'],
    ['hours', 'Abrimos de lunes a viernes de 10:00 a 20:00.'],
    ['payment', 'Aceptamos tarjeta.'],
  ];
  for (const [topic, answer] of samples) {
    const closing = closingForTopic(topic as Parameters<typeof closingForTopic>[0]);
    const out = closing ? `${answer}\n${closing}` : answer;
    assert.ok((out.match(/\?/g) ?? []).length <= 1, `"${out}" tiene más de una pregunta`);
  }
});
