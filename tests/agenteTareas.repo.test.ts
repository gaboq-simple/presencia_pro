// ─── Repo-check: el mapa de estados no se puede separar de su espejo ─────────
// La máquina de estados de las tareas del agente vive DOS veces: en
// `agente_tarea_permitidas()` (la autoridad, en la migración) y en
// `lib/agenteTareas.ts` (el espejo que usa la app). Dos copias de una regla se
// separan — es cuestión de tiempo, y el día que se separen la app va a ofrecer
// botones que la base rebota, o peor, va a esconder transiciones legítimas.
//
// Este check hace que separarlas ROMPA EL BUILD: lee el `CASE` real de la
// migración (no un comentario) y lo compara contra el objeto de TypeScript.
// Mismo patrón que `timeWindows.repo.test.ts` y el repo-check de propinas: la
// disciplina como gate, no como memoria.
//
// Puro: lee un archivo del repo, sin DB ni red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRANSICIONES, ESTADOS, type EstadoTarea } from '../apps/lifestyle/src/lib/agenteTareas.ts';

const MIGRACION = 'supabase/migrations/20260821000000_agente_tareas.sql';

/**
 * Extrae el mapa del `CASE` de `agente_tarea_permitidas`. Acepta las dos formas
 * que el archivo usa: `ARRAY['a','b']` y `ARRAY[]::text[]` (los terminales).
 */
function mapaDeLaMigracion(sql: string): Record<string, string[]> {
  const cuerpo = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.agente_tarea_permitidas'));
  const fin = cuerpo.indexOf('$$;');
  assert.ok(fin > 0, 'no se encontró el cuerpo de agente_tarea_permitidas en la migración');

  const mapa: Record<string, string[]> = {};
  const re = /WHEN\s+'([a-z]+)'\s+THEN\s+ARRAY\[([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cuerpo.slice(0, fin))) !== null) {
    const destinos = m[2]!
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s.length > 0);
    mapa[m[1]!] = destinos;
  }
  return mapa;
}

test('el mapa de la migración y el de lib/agenteTareas.ts son idénticos', () => {
  const sql = readFileSync(MIGRACION, 'utf8');
  const enSql = mapaDeLaMigracion(sql);

  assert.deepEqual(
    Object.keys(enSql).sort(),
    [...ESTADOS].sort(),
    'la migración no cubre exactamente los mismos estados que el módulo',
  );

  for (const estado of ESTADOS) {
    assert.deepEqual(
      [...(enSql[estado] ?? [])].sort(),
      [...TRANSICIONES[estado as EstadoTarea]].sort(),
      `divergen las transiciones de "${estado}": la BD manda, el módulo la espeja — corregir lib/agenteTareas.ts`,
    );
  }
});

test('el extractor no pasa por vacuidad: si el CASE cambiara, el check lo vería', () => {
  // Contraprueba del propio check. Si `mapaDeLaMigracion` devolviera {} ante
  // cualquier entrada, el test de arriba pasaría sin comparar nada.
  const falso = mapaDeLaMigracion(`
    CREATE OR REPLACE FUNCTION public.agente_tarea_permitidas(p_desde text)
    RETURNS text[] LANGUAGE sql AS $$
      SELECT CASE p_desde
        WHEN 'propuesta' THEN ARRAY['ejecutada']
        WHEN 'medida'    THEN ARRAY[]::text[]
      END;
    $$;
  `);
  assert.deepEqual(falso, { propuesta: ['ejecutada'], medida: [] });
  assert.notDeepEqual(falso['propuesta'], TRANSICIONES.propuesta);
});

test('la migración conserva sus tres candados (guard de estado, append-only, GUC)', () => {
  const sql = readFileSync(MIGRACION, 'utf8');
  // No son detalles de estilo: son las tres piezas que hacen que el estado no se
  // pueda mover sin dejar evento. Si alguien las quita, el primitivo se vuelve
  // una tabla común con nombres bonitos.
  assert.match(sql, /trg_agente_tareas_estado_guard/, 'falta el trigger que exige pasar por la función');
  assert.match(sql, /trg_agente_eventos_inmutables/, 'falta el append-only de los eventos');
  assert.match(sql, /set_config\('app\.agente_transicion', 'si', true\)/, 'falta el GUC transaction-local');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/, 'faltan las tablas con RLS');
});
