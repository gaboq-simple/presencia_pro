// ─── Repo-check: el catálogo de la app y el CHECK de la BD dicen lo mismo ─────
// `lib/caja.ts` declara `CONCEPTOS_POR_TIPO` como "ESPEJO EXACTO" del CHECK
// `caja_movimientos_concept_check`. Hasta M3 esa afirmación era una promesa
// escrita en un comentario: si alguien agregaba un concepto en un solo lado, la
// app ofrecía un botón que la BD rebotaba con un 23514 en la cara de quien lo
// tocaba —o peor, la BD aceptaba un concepto que ninguna vista sabía nombrar.
//
// Molde de `timeWindows.repo.test.ts` y `agenteTareas.repo.test.ts`: lee el SQL
// REAL de la migración, no un comentario, y rompe el build si divergen.
//
// Puro: lee dos archivos del repo, sin DB ni red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONCEPTOS_POR_TIPO } from '../apps/lifestyle/src/lib/caja';

const MIGRACION = 'supabase/migrations/20260906000000_caja_conceptos_finos.sql';

/** Saca los conceptos de cada rama del CHECK, leyendo el ADD CONSTRAINT. */
function conceptosDelCheck(sql: string): Record<string, string[]> {
  const add = sql.slice(sql.lastIndexOf('ADD CONSTRAINT caja_movimientos_concept_check'));
  const out: Record<string, string[]> = {};
  const re = /type\s*=\s*'(\w+)'\s*AND\s*concept\s+IN\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(add)) !== null) {
    out[m[1] as string] = [...(m[2] as string).matchAll(/'([a-z_]+)'/g)].map((x) => x[1] as string);
  }
  return out;
}

test('contraprueba del extractor: no devuelve {} ante cualquier cosa', () => {
  // Sin esto la comparación de abajo podría pasar por VACUIDAD (lección de
  // `agenteTareas.repo.test.ts`): un extractor roto que siempre devuelve nada
  // haría que dos objetos vacíos "coincidan" y el check quedaría de adorno.
  const real = conceptosDelCheck(readFileSync(MIGRACION, 'utf8'));
  assert.ok(Object.keys(real).length > 0, 'el extractor tiene que encontrar las ramas del CHECK');
  assert.ok((real['salida'] ?? []).length >= 2);
});

test('el catálogo de la app es el CHECK de la BD, concepto por concepto', () => {
  const real = conceptosDelCheck(readFileSync(MIGRACION, 'utf8'));
  for (const [tipo, conceptos] of Object.entries(CONCEPTOS_POR_TIPO)) {
    assert.deepEqual(
      [...conceptos].sort(),
      [...(real[tipo] ?? [])].sort(),
      `divergen los conceptos de '${tipo}': la app ofrecería un botón que la BD rebota`,
    );
  }
});

test('ningún concepto vale para los dos tipos, salvo `otro`', () => {
  // El CHECK está PAREADO a propósito: una "salida por producto" o una "entrada
  // por retiro" no significan nada. `otro` es el único legítimamente compartido.
  const entrada = new Set<string>(CONCEPTOS_POR_TIPO.entrada);
  const cruzados = CONCEPTOS_POR_TIPO.salida.filter((c) => entrada.has(c));
  assert.deepEqual(cruzados, ['otro']);
});
