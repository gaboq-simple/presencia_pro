// ─── Repo-check: lo que el código escribe tiene que caber en el CHECK del repo ─
// El caso que lo motivó (S9-DATA-01): `createAssistantAppointment` escribía
// `consented_via: 'pending_notice'` y las migraciones DEL REPO solo admitían tres
// valores — el cuarto lo agregó una migración que corrió en producción y **nunca
// tuvo archivo**. En prod funcionaba; en cualquier base reconstruida desde el
// repo el INSERT rebotaba, el llamador descartaba el error, y la cita se creaba
// sin cliente. Nadie se enteraba: ni una excepción, ni un log, ni un dato raro
// en pantalla.
//
// Lo que este check fija es la relación, no el valor: **el repo tiene que poder
// construir una base donde el código funcione.** Si mañana alguien escribe un
// literal nuevo, o amplía un CHECK solo en producción, esto se pone rojo.
//
// Por qué mira el SQL y no la BD: un test que consultara producción diría que
// todo está bien — producción es justamente donde el valor SÍ está permitido. La
// pregunta es sobre el repo.
//
// Puro: lee archivos del repo, sin DB ni red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIRS_MIGRACIONES = [
  'supabase/migrations',
  'apps/lifestyle/supabase/migrations',
];

/** Columnas vigiladas: `columna` → dónde escribe el código sus literales. */
const VIGILADAS = [
  { columna: 'consented_via', fuentes: ['apps/lifestyle/src', 'packages/engine/src'] },
] as const;

function todoElSql(): string {
  return DIRS_MIGRACIONES.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf8')),
  ).join('\n');
}

/**
 * Los valores que las migraciones del repo permiten para una columna — la UNIÓN
 * de todos los `CHECK (<columna> IN (...))` que aparecen en el repo.
 *
 * 🔴 Unión y no "el último gana", y la razón es un hallazgo en sí: el repo tiene
 *    DOS directorios de migraciones con esquemas de nombre distintos
 *    (`037_customer_consent.sql` y `20260819030909_consent_pending_notice.sql`) y
 *    **no hay un orden común entre ellos** — se interpolan en el tiempo, así que
 *    "el último" no está definido sin inventar una regla. Fingir un orden haría
 *    que este check dependiera de una convención que el repo no sostiene.
 *
 *    La unión igual atrapa el defecto que motivó todo esto, que es el caso duro:
 *    un literal que **ninguna** migración del repo permite. Lo que la unión NO
 *    puede ver es un CHECK que se contradice con otro; eso pide primero decidir
 *    el orden de las migraciones, y está anotado como tarea aparte.
 */
function valoresPermitidos(sql: string, columna: string): string[] | null {
  const re = new RegExp(`CHECK\\s*\\(\\s*${columna}\\s+IN\\s*\\(([^)]*)\\)`, 'gi');
  const union = new Set<string>();
  let hubo = false;
  for (const m of sql.matchAll(re)) {
    hubo = true;
    for (const lit of (m[1] ?? '').matchAll(/'([^']*)'/g)) union.add(lit[1] as string);
  }
  return hubo ? [...union] : null;
}

/** Los literales que el código escribe en esa columna (`columna: 'valor'`). */
function literalesEscritos(dirs: readonly string[], columna: string): Set<string> {
  const encontrados = new Set<string>();
  const re = new RegExp(`${columna}\\s*:\\s*'([^']+)'`, 'g');

  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) { recorrer(ruta); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      for (const m of readFileSync(ruta, 'utf8').matchAll(re)) encontrados.add(m[1] as string);
    }
  };
  dirs.forEach(recorrer);
  return encontrados;
}

for (const { columna, fuentes } of VIGILADAS) {
  test(`${columna}: todo literal que el código escribe cabe en el CHECK del repo`, () => {
    const permitidos = valoresPermitidos(todoElSql(), columna);
    assert.ok(
      permitidos && permitidos.length > 0,
      `no se encontró ningún CHECK de ${columna} en las migraciones del repo`,
    );

    const escritos = literalesEscritos(fuentes, columna);
    assert.ok(escritos.size > 0, `no se encontró ningún escritor de ${columna} en el código`);

    const huerfanos = [...escritos].filter((v) => !permitidos!.includes(v));
    assert.deepEqual(
      huerfanos,
      [],
      `el código escribe en ${columna} valores que las migraciones del repo NO permiten: ` +
      `${huerfanos.join(', ')}. Permitidos hoy: ${permitidos!.join(', ')}. ` +
      `Si el valor ya existe en producción, falta el archivo de esa migración en el repo.`,
    );
  });
}

// ─── Contraprueba: el candado tiene que poder fallar ──────────────────────────

test('CONTRAPRUEBA — sin el archivo restaurado, el check se pone rojo', () => {
  // El SQL del repo TAL COMO ESTABA antes de S9-DATA-01: solo la migración 037,
  // con sus tres valores. Es el estado exacto que producía el defecto.
  const sqlSinElArchivo =
    "CHECK (consented_via IN ('whatsapp_first_message', 'manual_registration', 'import'))";

  const permitidos = valoresPermitidos(sqlSinElArchivo, 'consented_via');
  const escritos = literalesEscritos(['apps/lifestyle/src'], 'consented_via');
  const huerfanos = [...escritos].filter((v) => !permitidos!.includes(v));

  assert.ok(
    huerfanos.includes('pending_notice'),
    'con el CHECK viejo el check DEBE detectar pending_notice — si no, no está midiendo nada',
  );
});

// ─── El CHECK que se restauró es el que corrió en producción ──────────────────

test('el repo admite los cuatro valores que admite producción', () => {
  // Los mismos cuatro del CHECK real de prod, verificado contra `pg_constraint`
  // el 2026-09-03. Si producción se amplía otra vez sin archivo, esto se cae.
  const permitidos = valoresPermitidos(todoElSql(), 'consented_via');
  assert.deepEqual(
    [...(permitidos ?? [])].sort(),
    ['import', 'manual_registration', 'pending_notice', 'whatsapp_first_message'],
  );
});
