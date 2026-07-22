// ─── AUD-07d: endurecimiento del clasificador ─────────────────────────────────
// 4 frentes:
//   1. temperature: 0 en ambos clasificadores — con la default (1.0), el mismo
//      "va" producía confidences distintas entre ejecuciones idénticas y
//      cruzaba los umbrales 0.85/0.60 "según el día".
//   2. max_tokens 256/300 → 512 — el JSON con side_question_answer larga se
//      truncaba a media string → parse-fail → "No entendí" tras pregunta clara.
//   3. Template del multi SIN campos poblados (el ejemplo omni-campo invitaba a
//      Haiku a copiar "confirmYes": true espurio → falso booking-signal) +
//      few-shots de los casos duros documentados ("si, a las 6").
//   4. Anti-repetición CON el mensaje anterior del bot en el user-turn (antes
//      se pedía "no uses el mismo texto" sin darle el texto — inverificable).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { callClaude } from '../packages/engine/src/bot/lifestyle/claudeClient';
import {
  buildClassifierSystemPrompt,
  buildMultiIntentSystemPrompt,
} from '../packages/engine/src/bot/lifestyle/classifier';

// ─── 1. callClaude pasa temperature solo cuando se pide ──────────────────────

function makeFakeClient(captured: Record<string, unknown>[]) {
  return {
    messages: {
      create: async (body: Record<string, unknown>) => {
        captured.push(body);
        return { content: [{ type: 'text', text: '{}' }] };
      },
    },
  } as never;
}

const BASE = {
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 512,
  messages: [{ role: 'user' as const, content: 'hola' }],
  timeoutMs: 5000,
  context: { businessId: 'biz', customerPhone: '521', state: 'test' },
};

test('callClaude pasa temperature:0 cuando se especifica', async () => {
  const captured: Record<string, unknown>[] = [];
  await callClaude({ ...BASE, client: makeFakeClient(captured), temperature: 0 });
  assert.equal(captured[0]!['temperature'], 0);
  assert.equal(captured[0]!['max_tokens'], 512);
});

test('callClaude NO manda temperature si no se pide (generativas Sonnet intactas)', async () => {
  const captured: Record<string, unknown>[] = [];
  await callClaude({ ...BASE, client: makeFakeClient(captured) });
  assert.ok(!('temperature' in captured[0]!));
});

// ─── 3a. Multi: sin template omni-campo + few-shots de casos duros ───────────

test('el prompt del multi ya NO muestra el esquema con todos los campos poblados', () => {
  const prompt = buildMultiIntentSystemPrompt(['Corte de cabello'], ['Carlos']);

  // El viejo template mostraba las 8 llaves juntas con valores — invitación a copiarlas.
  assert.doesNotMatch(prompt, /"confirmYes":\s+true,\s*\n\s*"confirmNo":\s+true,\s*\n\s*"unclear":\s+true/);
  assert.match(prompt, /incluye SOLO los que encontraste/);
  assert.match(prompt, /NUNCA por defecto/);
});

test('el prompt del multi trae few-shots, incluido el caso duro "si, a las 6"', () => {
  const prompt = buildMultiIntentSystemPrompt(['Corte de cabello'], ['Carlos']);

  assert.match(prompt, /## Ejemplos/);
  assert.match(prompt, /"si, a las 6"/);
  assert.match(prompt, /\{"confirmYes":true,"timeMatch"/);   // afirmación Y hora juntas
  assert.match(prompt, /\{"unclear":true\}/);
});

// ─── 3b. Single: few-shots presentes ─────────────────────────────────────────

test('el prompt del single trae few-shots (CONFIRM_YES / DATE_PREFERENCE / UNCLEAR)', () => {
  const prompt = buildClassifierSystemPrompt(['Corte'], '¿Qué servicio?', 'Negocio: Demo');

  assert.match(prompt, /## Ejemplos/);
  assert.match(prompt, /"intent":"CONFIRM_YES"/);
  assert.match(prompt, /"intent":"DATE_PREFERENCE"/);
  assert.match(prompt, /"intent":"UNCLEAR"/);
});
