// ─── Residuo LLM (post-deuda #1): system corto + answer en el multi ──────────
// Tres frentes de la tarea:
//   1. buildMicroCopySystemPrompt: system acotado para llamadas que solo
//      REDACTAN una pieza corta (reformular pregunta, confirmación, side answer)
//      — sin el flujo de 7 pasos del system completo.
//   2. classifyMultiIntent con businessContext: el extractor redacta
//      sideQuestion.answer en la MISMA llamada (mata la 2ª llamada redundante
//      de greeting → classifyIntent en el path defer).
//   3. El path defer de greeting consume ese answer y ya NO llama a
//      classifyIntent (verificado con spy sobre el classifier inyectado).
//
// Deterministas: sin red, classifier mockeado vía deps.classifier (deuda #1).
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt, buildMicroCopySystemPrompt, FORMATTING_RULES } from '../packages/engine/src/bot/lifestyle/prompt';
import {
  buildMultiIntentSystemPrompt,
  parseMultiIntentResponse,
  type IntentClassification,
  type MultiIntentClassification,
} from '../packages/engine/src/bot/lifestyle/classifier';
import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { business as fixtureBusiness, catalog } from './fixtures/lifestyle';

// ─── 1. System corto para micro-copy ─────────────────────────────────────────

test('buildMicroCopySystemPrompt lleva persona + reglas de formato, SIN el flujo de 7 pasos', () => {
  const micro = buildMicroCopySystemPrompt(fixtureBusiness);

  // Persona mínima: identidad del bot y del negocio.
  assert.match(micro, new RegExp(fixtureBusiness.botName));
  assert.match(micro, new RegExp(fixtureBusiness.name));
  // Reglas de formato de la casa (fuente única).
  assert.ok(micro.includes(FORMATTING_RULES));
  // NADA del flujo de agendamiento: es un redactor, no un turno conversacional.
  assert.doesNotMatch(micro, /Flujo de agendamiento/);
  assert.doesNotMatch(micro, /Confirmación — resume todos los detalles/);
  assert.doesNotMatch(micro, /Manejo de situaciones especiales/);
  // No saluda ni abre conversación (el leak de saludo fue S5-BOT-09).
  assert.match(micro, /No saludas/);
});

test('buildMicroCopySystemPrompt incluye datos del negocio SOLO cuando se pasan', () => {
  const sin = buildMicroCopySystemPrompt(fixtureBusiness);
  const con = buildMicroCopySystemPrompt(fixtureBusiness, { businessContext: 'Dirección: Calle Falsa 123.' });

  assert.doesNotMatch(sin, /Datos del negocio/);
  assert.match(con, /Datos del negocio/);
  assert.match(con, /Calle Falsa 123/);
});

test('el system corto es sustancialmente más chico que el completo (el punto de la tarea)', () => {
  const full  = buildSystemPrompt(fixtureBusiness, undefined, catalog);
  const micro = buildMicroCopySystemPrompt(fixtureBusiness);
  assert.ok(
    micro.length < full.length / 2,
    `micro (${micro.length}) debería ser < mitad del completo (${full.length})`,
  );
});

// ─── 2. Multi-intent: businessContext + answer en el schema ──────────────────

test('el prompt del multi SIN businessContext no menciona answer (retrocompatible)', () => {
  const p = buildMultiIntentSystemPrompt(['Corte'], ['Carlos']);
  assert.doesNotMatch(p, /"answer"/);
  assert.doesNotMatch(p, /Contexto del negocio/);
});

test('el prompt del multi CON businessContext trae el bloque de datos, la regla de answer y el few-shot con answer', () => {
  const p = buildMultiIntentSystemPrompt(['Corte'], ['Carlos'], 'Negocio: Barbería Demo. Corte $150 (30 min).');
  assert.match(p, /## Contexto del negocio/);
  assert.match(p, /Barbería Demo/);
  // Regla: answer solo con datos reales, null si no hay dato, formato de la casa.
  assert.match(p, /genera también "answer"/);
  assert.match(p, /pon null en answer/);
  assert.ok(p.includes(FORMATTING_RULES));
  // El few-shot de sideQuestion ahora ejemplifica el answer.
  assert.match(p, /"answer":"El corte cuesta \$150/);
});

test('parseMultiIntentResponse extrae answer cuando viene; lo omite cuando falta o es vacío', () => {
  const conAnswer = parseMultiIntentResponse(
    '{"sideQuestion":{"question":"cuanto cuesta?","topic":"price","answer":"El corte sale en $150."}}',
  );
  assert.equal(conAnswer.sideQuestion?.answer, 'El corte sale en $150.');

  const sinAnswer = parseMultiIntentResponse(
    '{"sideQuestion":{"question":"cuanto cuesta?","topic":"price"}}',
  );
  assert.equal(sinAnswer.sideQuestion?.answer, undefined);

  const answerNull = parseMultiIntentResponse(
    '{"sideQuestion":{"question":"cuanto cuesta?","topic":"price","answer":null}}',
  );
  assert.equal(answerNull.sideQuestion?.answer, undefined);

  const answerVacio = parseMultiIntentResponse(
    '{"sideQuestion":{"question":"cuanto cuesta?","topic":"price","answer":"  "}}',
  );
  assert.equal(answerVacio.sideQuestion?.answer, undefined);
});

// ─── 3. Greeting: el path defer consume el answer del multi (una sola llamada) ─

const TZ    = 'America/Mexico_City';
const NOW   = new Date('2026-07-20T18:00:00.000Z'); // lunes ~12:00 local
const CUST  = '99999999-9999-9999-9999-999999999999';
const SVC   = '22222222-2222-2222-2222-222222222222';
const PHONE = '5215500000000';

type Row = Record<string, unknown>;

function makeSupabase(tablesData: Record<string, Row[]>) {
  const from = (table: string) => {
    let rows = [...(tablesData[table] ?? [])];
    const filter = (col: string, pass: (a: unknown) => boolean) => {
      rows = rows.filter((r) => (col in r ? pass(r[col]) : true));
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:  (c: string, v: unknown) => { filter(c, (a) => a === v); return builder; },
      gt: () => builder, gte: () => builder, lt: () => builder, lte: () => builder,
      in: () => builder, neq: () => builder, not: () => builder, order: () => builder,
      limit: (n: number) => { rows = rows.slice(0, n); return builder; },
      insert: () => builder, update: () => builder, upsert: () => builder,
      single:      () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as never;
}

let bizCounter = 0;

/**
 * Deps de greeting con classifier espiado: el multi devuelve una sideQuestion
 * de horario (officeHours null en el negocio → routeSideQuestion = defer) y
 * classifyIntent CUENTA cuántas veces lo llaman — la tarea exige CERO.
 */
function makeDeps(multiResult: MultiIntentClassification) {
  bizCounter += 1;
  const bizId = `biz-llm-${bizCounter}`; // único → aísla el cache de catálogo
  const business = {
    id:                    bizId,
    name:                  'Barbería Demo',
    whatsappNumber:        '5210000000000',
    whatsappPhoneNumberId: 'pnid-1',
    botName:               'Asistente',
    awayMessage:           'Cerrado.',
    fallbackMessage:       'Te comunico con el equipo.',
    officeHours:           null, // ← hace que topic 'hours' DEFIERA (sin dato determinista)
    walkInBufferMinutes:   60,
    address:               'Calle 1',
    timezone:              TZ,
  };
  const singleCalls: unknown[] = [];
  const classifier = {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => multiResult,
    classifyIntent: async (): Promise<IntentClassification> => {
      singleCalls.push(1);
      return { intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null };
    },
  };
  const tablesData: Record<string, Row[]> = {
    customers: [{ id: CUST, business_id: bizId, phone: PHONE, name: 'Juan', favorite_staff_id: null, favorite_service_id: null, last_visit: null, favorite_staff: null, favorite_service: null }],
    services:  [{ id: SVC, business_id: bizId, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true }],
    staff:     [],
    bot_logs:  [],
  };
  const deps = {
    business,
    supabase:     makeSupabase(tablesData),
    anthropicKey: '',
    model:        'haiku',
    classifier,
  } as never;
  return { deps, singleCalls };
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.llm-test',
  } as never;
}

test('defer con answer del multi: responde con ESE texto y NO dispara la 2ª llamada', async () => {
  const { deps, singleCalls } = makeDeps({
    sideQuestion: {
      question: '¿a qué hora abren?',
      topic:    'hours',
      answer:   'Abrimos de 10 de la mañana a 8 de la noche.',
    },
  });

  const r = await dispatch('GREETING', makeMsg('¿a qué hora abren?'), {}, deps);

  // La respuesta del multi viaja al cliente (compuesta por el saludo lateral).
  assert.match(r.responseText, /Abrimos de 10 de la mañana a 8 de la noche\./);
  // CERO llamadas a classifyIntent — la 2ª llamada redundante murió.
  assert.equal(singleCalls.length, 0);
});

test('defer SIN answer (multi no tuvo el dato): cae al fallback [DERIVA], sigue sin 2ª llamada', async () => {
  const { deps, singleCalls } = makeDeps({
    sideQuestion: { question: '¿a qué hora abren?', topic: 'hours' },
  });

  const r = await dispatch('GREETING', makeMsg('¿a qué hora abren?'), {}, deps);

  // Fallback determinista honesto (sin minisite → deriva al equipo), nunca vacío.
  assert.ok(r.responseText.trim().length > 0);
  assert.doesNotMatch(r.responseText, /Abrimos/);
  assert.equal(singleCalls.length, 0);
});
