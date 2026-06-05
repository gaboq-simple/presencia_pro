// S4-BOT-05 — Tests de continuidad conversacional (anti re-saludo).
// Puros y deterministas: sin red, sin Supabase, sin Anthropic. Corren en ms.
// Ejecutar: npm test
//
// Cubre FIX 3: cuando la conversación YA está en curso (hay historial), la
// instrucción/fallback que se construye para el generador NO debe contener
// lenguaje de bienvenida. Conversación nueva (sin historial) SÍ saluda.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isConversationInProgress,
  buildGenerativeMessages,
  buildDefaultGreetingPlan,
  CONTINUATION_INSTRUCTION,
  CONTINUATION_FALLBACK,
  RECENT_TURNS,
  type ConvTurn,
} from '../packages/engine/src/bot/lifestyle/continuity';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Regex que detecta lenguaje de bienvenida (saludo) en español. */
const GREETING_WORDS = /\b(hola|bienvenid[oa]|buen(os|as)\s+(días|dias|tardes|noches)|que gusto|gusto verte|gusto de verte)\b/i;

const NEW_CONVERSATION = {
  isReturning:    false,
  customerName:   'Cliente',
  favStaffName:   null,
  favServiceName: null,
  businessName:   'Barbería El Corte',
  botName:        'Zlot',
};

// ─── isConversationInProgress ─────────────────────────────────────────────────

test('isConversationInProgress: historial vacío o undefined → false', () => {
  assert.equal(isConversationInProgress(undefined), false);
  assert.equal(isConversationInProgress([]), false);
});

test('isConversationInProgress: con al menos un turno → true', () => {
  assert.equal(isConversationInProgress([{ role: 'user', content: 'hola' }]), true);
});

// ─── buildGenerativeMessages ──────────────────────────────────────────────────

test('buildGenerativeMessages: historial + instrucción como turno final del usuario', () => {
  const history: ConvTurn[] = [
    { role: 'user', content: 'quiero corte' },
    { role: 'assistant', content: 'con gusto, para que dia?' },
  ];
  const out = buildGenerativeMessages(history, 'Continua el hilo.');
  assert.equal(out.length, 3);
  assert.deepEqual(out[2], { role: 'user', content: 'Continua el hilo.' });
  assert.equal(out[out.length - 1]!.role, 'user');
});

test('buildGenerativeMessages: recorta el historial a RECENT_TURNS', () => {
  const history: ConvTurn[] = Array.from({ length: 20 }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as ConvTurn['role'],
    content: `t${i}`,
  }));
  const out = buildGenerativeMessages(history, 'instr');
  // RECENT_TURNS del historial + 1 instrucción.
  assert.equal(out.length, RECENT_TURNS + 1);
  assert.equal(out[out.length - 1]!.content, 'instr');
});

test('buildGenerativeMessages: sin historial → solo la instrucción', () => {
  const out = buildGenerativeMessages(undefined, 'instr');
  assert.deepEqual(out, [{ role: 'user', content: 'instr' }]);
});

// ─── buildDefaultGreetingPlan: conversación NUEVA (sí saluda) ──────────────────

test('plan: conversación nueva (sin historial) → instrucción y fallback SÍ saludan', () => {
  const plan = buildDefaultGreetingPlan({ ...NEW_CONVERSATION, history: [] });
  assert.match(plan.deterministicFallback, GREETING_WORDS);
  // El bot nuevo se presenta con su nombre.
  assert.match(plan.deterministicFallback, /Zlot/);
});

test('plan: cliente recurrente con favoritos (sin historial) → saluda por nombre', () => {
  const plan = buildDefaultGreetingPlan({
    isReturning:    true,
    customerName:   'Gabriel',
    favStaffName:   'Luis',
    favServiceName: 'Corte clásico',
    businessName:   'Barbería El Corte',
    botName:        'Zlot',
    history:        [],
  });
  assert.match(plan.deterministicFallback, GREETING_WORDS);
  assert.match(plan.deterministicFallback, /Gabriel/);
  assert.match(plan.sonnetInstruction, /Corte clásico/);
});

// ─── buildDefaultGreetingPlan: conversación EN CURSO (anti re-saludo) ──────────

test('plan: conversación en curso → instrucción de CONTINUACIÓN, sin saludo', () => {
  const history: ConvTurn[] = [
    { role: 'user', content: 'quiero un corte' },
    { role: 'assistant', content: 'con gusto, para que dia te gustaria?' },
  ];
  const plan = buildDefaultGreetingPlan({ ...NEW_CONVERSATION, history });

  assert.equal(plan.sonnetInstruction, CONTINUATION_INSTRUCTION);
  assert.equal(plan.deterministicFallback, CONTINUATION_FALLBACK);

  // Anti re-saludo: el texto que ve el cliente (fallback determinista) no saluda.
  assert.doesNotMatch(plan.deterministicFallback, GREETING_WORDS);
  // La instrucción ordena explícitamente NO saludar / NO dar la bienvenida.
  assert.match(plan.sonnetInstruction, /NO saludes/);
  assert.match(plan.sonnetInstruction, /NO des la bienvenida/);
});

test('plan: en curso ignora favoritos/recurrencia y NO re-saluda (anti re-saludo)', () => {
  // Aunque el cliente sea recurrente con favoritos, si la conversación ya está
  // en curso NO debe re-saludar por nombre.
  const history: ConvTurn[] = [{ role: 'user', content: 'mañana a las 5' }];
  const plan = buildDefaultGreetingPlan({
    isReturning:    true,
    customerName:   'Gabriel',
    favStaffName:   'Luis',
    favServiceName: 'Corte clásico',
    businessName:   'Barbería El Corte',
    botName:        'Zlot',
    history,
  });
  assert.doesNotMatch(plan.deterministicFallback, GREETING_WORDS);
  assert.doesNotMatch(plan.deterministicFallback, /Gabriel/);
});

// ─── Reproducción del bug de la evidencia real ────────────────────────────────
// En el smoke test, el bot saludó de nuevo a media conversación porque el
// historial no llegaba al generador. Aquí: dado historial previo, la instrucción
// que se construye para el generador NO incluye un saludo de bienvenida.

test('reproduce bug: tras saludo+respuesta previa, el siguiente turno NO re-saluda', () => {
  // Turno 1 ya ocurrió: bot saludó y cliente respondió con su intención.
  const history: ConvTurn[] = [
    { role: 'assistant', content: 'Hola, soy Zlot. En que puedo ayudarte?' },
    { role: 'user', content: 'quiero agendar un corte' },
  ];

  // Turno 2: el handler vuelve a GREETING (caso 'none') y construye el plan.
  const plan = buildDefaultGreetingPlan({ ...NEW_CONVERSATION, history });
  const messages = buildGenerativeMessages(history, plan.sonnetInstruction);

  // La instrucción final (último mensaje del usuario al generador) ordena NO
  // re-saludar; el fallback determinista que vería el cliente no saluda.
  const finalInstruction = messages[messages.length - 1]!;
  assert.equal(finalInstruction.role, 'user');
  assert.match(finalInstruction.content, /NO saludes/);
  assert.doesNotMatch(plan.deterministicFallback, GREETING_WORDS);

  // El historial previo SÍ viaja al generador, para que tenga contexto del hilo.
  assert.ok(messages.length > 1, 'el historial previo se pasa al generador');
  assert.equal(messages[0]!.content, 'Hola, soy Zlot. En que puedo ayudarte?');
});
