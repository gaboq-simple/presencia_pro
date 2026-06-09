// S4-BOT-09 — Tests del hotfix del bucle en QUALIFYING_SERVICE.
// Puros y deterministas: sin red, sin Supabase real, sin Anthropic.
// Ejecutar: npm test
//
// Cubre la regresión reportada (negocio de servicio único atascado repitiendo
// la oferta sin avanzar) en sus dos causas:
//   #1 Servicio único: el cliente no nombra el servicio → debe auto-resolverse
//      y avanzar a QUALIFYING_STAFF (en vez de preguntar "¿cuál servicio?").
//   #2 Anti-loop: un ADVANCE de alta confianza que NO resuelve servicio NO debe
//      resetear clarification_attempts a 0 — debe SUBIR para que tras
//      MAX_TOTAL_ATTEMPTS el flujo escale a FALLBACK (no bucle infinito).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleQualifyingService,
  looksLikeSideQuestion,
  repeatFallbackContext,
} from '../packages/engine/src/bot/lifestyle/states/qualifyingService';
import { handleClassification } from '../packages/engine/src/bot/lifestyle/clarification';
import { invalidateBusinessCache } from '../packages/engine/src/bot/lifestyle/catalog';
import type { IntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type {
  LifestyleBusinessConfig,
  LifestyleIncomingMessage,
  ServiceRow,
} from '../packages/engine/src/bot/lifestyle/types';
import { business as bizFixture, serviceExact } from './fixtures/lifestyle';

// ─── Fake Supabase (solo lo que usa getCatalog) ───────────────────────────────

function makeSupabase(services: ServiceRow[]) {
  const from = () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      order:  () => builder,
      then:   (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: services, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

function makeDeps(businessId: string, services: ServiceRow[]) {
  const business: LifestyleBusinessConfig = { ...bizFixture, id: businessId };
  invalidateBusinessCache(businessId); // evita fugas del cache TTL entre tests
  return {
    business,
    supabase:     makeSupabase(services),
    anthropicKey: '',          // nunca debe llegar a usarse en el fast-path
    model:        'claude-haiku-4-5-20251001',
  };
}

function makeMsg(body: string, businessId: string): LifestyleIncomingMessage {
  return {
    businessId,
    customerPhone: '5215588067111',
    customerName:  'Gabriel',
    body,
    timestamp:     new Date('2026-06-09T03:39:00Z'),
    messageId:     `wamid.${Math.random()}`,
  };
}

const SINGLE: ServiceRow[] = [{ ...serviceExact, id: 'svc-unico', name: 'Corte de cabello' }];

// ─── #1 — Auto-resolver servicio único ────────────────────────────────────────

test('#1 servicio único: "quiero agendar una cita" avanza a QUALIFYING_STAFF sin preguntar cuál', async () => {
  const deps = makeDeps('biz-single-1', SINGLE);
  const result = await handleQualifyingService(makeMsg('quiero agendar una cita', 'biz-single-1'), {}, deps);

  assert.equal(result.newState, 'QUALIFYING_STAFF');
  assert.equal(result.newContext.serviceId, 'svc-unico');
  assert.doesNotMatch(result.responseText, /servicio/i, 'no debe re-preguntar el servicio');
});

test('#1 servicio único: las entradas que disparaban el bucle ("Sí"/"No"/"dale") ahora avanzan', async () => {
  for (const body of ['Sí', 'Si', 'No', 'dale', 'agéndame']) {
    const id = `biz-single-loop-${body}`;
    const deps = makeDeps(id, SINGLE);
    const result = await handleQualifyingService(makeMsg(body, id), {}, deps);
    assert.equal(result.newState, 'QUALIFYING_STAFF', `"${body}" debe avanzar, no quedarse en QUALIFYING_SERVICE`);
    assert.equal(result.newContext.serviceId, 'svc-unico');
  }
});

// Nota: el caso negativo a nivel handler ("¿cuánto cuesta?" NO se auto-resuelve)
// alcanzaría al clasificador (red). La discriminación queda cubierta de forma
// 100% pura por el unit test de looksLikeSideQuestion de abajo.

// ─── Detector determinista looksLikeSideQuestion ──────────────────────────────

test('looksLikeSideQuestion: afirmaciones e intención de reserva → false', () => {
  for (const t of ['sí', 'si', 'no', 'dale', 'va', 'quiero agendar una cita', 'agéndame una cita', 'ok']) {
    assert.equal(looksLikeSideQuestion(t), false, `"${t}" no es side-question`);
  }
});

test('looksLikeSideQuestion: preguntas sobre el negocio → true', () => {
  for (const t of [
    '¿cuánto cuesta?', 'que precio tiene', 'donde estan', 'cual es la direccion',
    'a que hora abren', 'tienen estacionamiento', 'aceptan tarjeta', 'atienden niños',
    'cuanto dura el corte', 'tienen reseñas',
  ]) {
    assert.equal(looksLikeSideQuestion(t), true, `"${t}" SÍ es side-question`);
  }
});

// ─── #2 — Red de seguridad anti-loop ──────────────────────────────────────────

// Modelo puro del turno del handler en el camino ADVANCE-sin-resolver: replica
// la aritmética real (handleClassification + repeatFallbackContext + guard).
const MAX_TOTAL_ATTEMPTS = 5;
const ADVANCE_NO_RESOLVE: IntentClassification = {
  intent:               'CONFIRM_YES',  // alta confianza, pero value no es un servicio
  confidence:           0.95,
  value:                null,
  side_question_answer: null,
};

function simulateTurn(context: LifestyleBotContext): { context: LifestyleBotContext; escalates: boolean } {
  const attempts = context.clarification_attempts ?? 0;
  const clarResult = handleClassification({
    classification:        ADVANCE_NO_RESOLVE,
    currentState:          'QUALIFYING_SERVICE',
    context,
    availableOptions:      ['Corte de cabello'],
    clarificationAttempts: attempts,
  });
  // En el handler real, valueMatches está vacío → cae al camino REPEAT_OPTIONS.
  const fallbackCtx = repeatFallbackContext(clarResult, attempts);
  const escalates = (fallbackCtx.clarification_attempts ?? 0) >= MAX_TOTAL_ATTEMPTS;
  return { context: fallbackCtx, escalates };
}

test('#2 repeatFallbackContext: ADVANCE-sin-resolver incrementa attempts (no lo resetea a 0)', () => {
  const clarResult = handleClassification({
    classification:        ADVANCE_NO_RESOLVE,
    currentState:          'QUALIFYING_SERVICE',
    context:               { clarification_attempts: 0 },
    availableOptions:      ['Corte de cabello'],
    clarificationAttempts: 0,
  });
  assert.equal(clarResult.action, 'ADVANCE');
  assert.equal(clarResult.updatedContext.clarification_attempts, 0, 'handleClassification resetea a 0 en ADVANCE');
  // El fix restaura el incremento para que el escape sea alcanzable.
  const fixed = repeatFallbackContext(clarResult, 0);
  assert.equal(fixed.clarification_attempts, 1);
});

test('#2 anti-loop: ADVANCE-sin-resolver repetido SUBE attempts y escala a FALLBACK (no bucle infinito)', () => {
  let ctx: LifestyleBotContext = {};
  const seen: number[] = [];
  let escalatedAt = -1;

  for (let turn = 1; turn <= 12; turn++) {
    const r = simulateTurn(ctx);
    seen.push(r.context.clarification_attempts ?? 0);
    ctx = r.context;
    if (r.escalates) { escalatedAt = turn; break; }
  }

  // El contador es monótonamente creciente (el bug lo dejaba clavado en 0).
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i]! > seen[i - 1]!, `attempts debe subir: ${JSON.stringify(seen)}`);
  }
  // Y el escape a humano es ALCANZABLE en un número finito de turnos.
  assert.ok(escalatedAt > 0 && escalatedAt <= MAX_TOTAL_ATTEMPTS, `debe escalar (turno ${escalatedAt})`);
});

test('#2 regresión: SIN el fix (usando el contexto reseteado del clasificador) el contador queda en 0 → bucle', () => {
  // Demuestra la causa raíz: si persistiéramos clarResult.updatedContext tal cual
  // en el camino ADVANCE, attempts nunca sube y el guard nunca dispara.
  let ctx: LifestyleBotContext = {};
  for (let turn = 1; turn <= 10; turn++) {
    const attempts = ctx.clarification_attempts ?? 0;
    const clarResult = handleClassification({
      classification:        ADVANCE_NO_RESOLVE,
      currentState:          'QUALIFYING_SERVICE',
      context:               ctx,
      availableOptions:      ['Corte de cabello'],
      clarificationAttempts: attempts,
    });
    ctx = clarResult.updatedContext; // comportamiento BUGGY (sin repeatFallbackContext)
  }
  assert.equal(ctx.clarification_attempts ?? 0, 0, 'reproduce el bucle: attempts clavado en 0');
});
