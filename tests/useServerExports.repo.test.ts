// ─── Repo-check: en 'use server', `export type { X }` sin `from` revienta ─────
// EL DEFECTO, QUE PASÓ DOS VECES EN UN DÍA. En un archivo con `'use server'`, un
// `export type { X };` que re-exporta un binding IMPORTADO —sin cláusula `from`—
// parece inofensivo: para TypeScript es un tipo y se borra al compilar. Pero
// Turbopack lo convierte en un re-export de VALOR y la ruta revienta en runtime
// con `ReferenceError: X is not defined`.
//
// LA FORMA IMPORTA, y se midió en este mismo repo:
//   · `export type { X };`                    → REVIENTA  (X vino de un import)
//   · `export type { X } from './x';`         → funciona   (`assistant-actions.ts:1009`)
//   · `export type X = Y;`  ·  `export interface X {}` → funcionan (son declaraciones)
// Por eso el check mira SOLO la primera forma. Uno más amplio marcaría diez casos
// que funcionan hoy, y un check que grita en falso es un check que alguien apaga.
//
// Lo peor no es el error: es QUIÉN lo encuentra. `tsc` pasa limpio, `eslint` pasa
// limpio y la suite pasa limpia. Solo aparece cargando la página. Pasó con
// `CobroSinRiel` en M2, quedó documentado en las notas de ejecución… y volvió a
// pasar con `EstadoFijo` en M4, escrito por la misma mano que lo había anotado.
// Una lección que no está en el build es una lección que se vuelve a pagar.
//
// LA SALIDA CORRECTA no es exportar el tipo desde otro lado por conveniencia: es
// que el tipo VIVA en el módulo puro que ya lo define (`lib/fijos.ts`,
// `lib/corteData.ts`) y que la vista lo importe de ahí con `import type`. La
// action exporta funciones; los tipos son de quien los define.
//
// Puro: lee archivos del repo, sin DB ni red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = 'apps/lifestyle/src';

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivosTs(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** ¿El archivo declara `'use server'` a nivel de MÓDULO (primeras líneas)? */
function esUseServer(src: string): boolean {
  const cabeza = src.split('\n').slice(0, 20).join('\n');
  return /^\s*['"]use server['"]\s*;?\s*$/m.test(cabeza);
}

/**
 * Solo la forma que revienta: `export type { … }` SIN cláusula `from`.
 * Con `from` el módulo de origen queda declarado y Turbopack lo resuelve bien;
 * `export type X = …` y `export interface X` son declaraciones, no re-exports.
 */
function reexportsDeTipoSinFrom(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(/^[^\S\n]*export\s+type\s*\{([^}]*)\}\s*(from\s*['"][^'"]+['"])?\s*;?/gm)) {
    if (m[2]) continue; // tiene `from`: es la forma que sí funciona
    hits.push(`export type { ${(m[1] as string).replace(/\s+/g, ' ').trim()} }`);
  }
  return hits;
}

const TODOS = archivosTs(RAIZ);
const SERVER = TODOS.filter((f) => esUseServer(readFileSync(f, 'utf8')));

test('contraprueba: el detector encuentra los módulos de server actions', () => {
  // Sin esto el check podría pasar por VACUIDAD: un detector roto que no
  // encuentra ningún archivo haría que "ninguno exporta tipos" fuera trivialmente
  // cierto (lección de `agenteTareas.repo.test.ts`).
  assert.ok(SERVER.length >= 4, `esperaba varios módulos 'use server', encontré ${SERVER.length}`);
  assert.ok(SERVER.some((f) => f.endsWith('caja-actions.ts')));
  assert.ok(SERVER.some((f) => f.endsWith('assistant-actions.ts')));
});

test('contraprueba: el detector separa la forma que revienta de las que no', () => {
  // La que revienta:
  assert.deepEqual(reexportsDeTipoSinFrom('export type { A };'), ['export type { A }']);
  assert.deepEqual(reexportsDeTipoSinFrom('export type { A, B };'), ['export type { A, B }']);
  // Las que funcionan, medidas en este repo:
  assert.deepEqual(reexportsDeTipoSinFrom("export type { A } from './x';"), []);
  assert.deepEqual(reexportsDeTipoSinFrom('export type B = string;'), []);
  assert.deepEqual(reexportsDeTipoSinFrom('export interface C {}'), []);
  assert.deepEqual(reexportsDeTipoSinFrom('export async function f() {}'), []);
  assert.deepEqual(reexportsDeTipoSinFrom('// export type { D };'), [],
    'un comentario no es un export');
});

test("★ ningún módulo 'use server' re-exporta un tipo sin `from`", () => {
  const malos: string[] = [];
  for (const f of SERVER) {
    const tipos = reexportsDeTipoSinFrom(readFileSync(f, 'utf8'));
    if (tipos.length > 0) malos.push(`  · ${f} → ${tipos.join(', ')}`);
  }
  assert.deepEqual(
    malos, [],
    'Esto revienta en RUNTIME con `ReferenceError`, y ni `tsc` ni `eslint` lo ven:\n' +
    'Turbopack vuelve el re-export de tipo un re-export de VALOR. Dos salidas, las\n' +
    'dos mejores que dejarlo: mover el tipo al módulo puro que lo define y que la\n' +
    'vista lo importe de ahí con `import type`, o agregarle la cláusula `from` que\n' +
    `declara de dónde sale:\n${malos.join('\n')}`,
  );
});
