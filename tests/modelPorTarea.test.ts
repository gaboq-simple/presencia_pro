// ─── Routing de modelo por TAREA de generación (punto 4 de AUD-01) ───────────
// La versión anterior seleccionaba modelo por ESTADO entrante y quedó invertida
// en la práctica: los estados "Sonnet" hardcodeaban HAIKU_MODEL local ×3 y las
// únicas llamadas que consumían deps.model vivían en estados "Haiku" — Sonnet
// no se usaba en NINGUNA llamada real. Ahora cada call site declara su tarea
// (modelForTask) y las constantes de modelo viven SOLO en modelRouter (+ el
// CLASSIFIER_MODEL de classifier.ts, que es frontera aparte).
//
// Deterministas: sin red. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  modelForTask,
  HAIKU_MODEL,
  SONNET_MODEL,
  type GenerationTask,
} from '../packages/engine/src/bot/lifestyle/modelRouter';
import { CLASSIFIER_MODEL } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── 1. El mapeo tarea → modelo ──────────────────────────────────────────────

test('conversational_turn (el turno de personalidad) es la ÚNICA tarea en Sonnet', () => {
  assert.equal(modelForTask('conversational_turn'), SONNET_MODEL);
  assert.equal(modelForTask('micro_copy'),          HAIKU_MODEL);
  assert.equal(modelForTask('slot_presentation'),   HAIKU_MODEL);
});

test('los IDs de modelo son los vigentes post-AUD-01 (nunca el Sonnet retirado)', () => {
  assert.equal(SONNET_MODEL, 'claude-sonnet-5');            // alias vigente sin fecha
  assert.equal(HAIKU_MODEL,  'claude-haiku-4-5-20251001');
  assert.equal(CLASSIFIER_MODEL, HAIKU_MODEL);              // el clasificador comparte Haiku
  // El modelo que causó la degradación silenciosa de AUD-01 no puede volver.
  for (const task of ['conversational_turn', 'micro_copy', 'slot_presentation'] as GenerationTask[]) {
    assert.notEqual(modelForTask(task), 'claude-sonnet-4-20250514');
  }
});

// ─── 2. Desduplicación blindada por escaneo de fuentes ───────────────────────
// Ningún archivo del bot lifestyle (fuera de modelRouter y classifier) puede
// hardcodear un model ID de Claude. Esto mata de raíz el patrón que causó la
// inversión: constantes HAIKU_MODEL locales copiadas en 3 states.

const LIFESTYLE_DIR = join(__dirname, '..', 'packages', 'engine', 'src', 'bot', 'lifestyle');
const ALLOWED_MODEL_ID_FILES = new Set(['modelRouter.ts', 'classifier.ts']);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('ningún archivo del bot (salvo modelRouter y classifier) hardcodea un model ID', () => {
  const offenders: string[] = [];
  for (const file of listTsFiles(LIFESTYLE_DIR)) {
    const base = file.split('/').pop()!;
    if (ALLOWED_MODEL_ID_FILES.has(base)) continue;
    // Solo CÓDIGO: las menciones en comentarios (p.ej. la nota histórica del
    // 404 de AUD-01 en claudeClient.ts) son legítimas.
    const src = readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    if (/claude-(haiku|sonnet|opus)-/.test(src)) offenders.push(base);
  }
  assert.deepEqual(
    offenders,
    [],
    `model IDs hardcodeados fuera de modelRouter/classifier: ${offenders.join(', ')} — usa modelForTask()`,
  );
});

test('el selector por ESTADO ya no existe (la selección es por tarea)', async () => {
  const router = await import('../packages/engine/src/bot/lifestyle/modelRouter');
  assert.equal(
    (router as Record<string, unknown>)['selectModel'],
    undefined,
    'selectModel (por estado) no debe reaparecer — la inversión de AUD-01 nació ahí',
  );
});
