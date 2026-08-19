// ─── Repo-check: las ventanas de consulta salen del helper (S7-BUG-01) ───────
// Cuatro veces apareció el mismo bug —PR #142, PR #144, S6-DATA-01 y ahora
// `revenueTrend`— y las tres primeras se arreglaron una por una. Este check
// arregla el PATRÓN: la disciplina como gate que rompe el build, igual que
// `tipsPrivacy` y `TENANT_TABLES`.
//
// **Qué prohíbe, exactamente.** No toda aritmética de fechas: hay decenas de usos
// legítimos (desplazar la etiqueta de un día, calcular un `YYYY-MM-DD` para una
// URL, la matemática interna de `tzUtils`/`slots`). Lo que prohíbe es lo que el
// bug rompía: **un archivo que arma su ventana con `Date.UTC` / `setUTCDate` Y la
// usa para filtrar una query** (`.gte(` / `.lt(` / `.lte(`). Esa combinación es
// siempre un error o siempre necesita una razón escrita.
//
// La regla positiva: la ventana sale de `lib/timeWindows.ts` (o de
// `lib/dayWindow.ts`, que es su base tz-aware).
//
// Puro (sin DB): `git grep` sobre los árboles de código. `--untracked` para que
// un archivo nuevo sin commitear también cuente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const SOURCE_TREES = ['apps/lifestyle/src', 'packages/engine/src'];

/** Construcción cruda de instantes. `new Date('YYYY-MM-DD…')` no entra: es
 *  parseo, no aritmética, y lo usan las etiquetas por todos lados. */
const CRUDO = String.raw`Date\.UTC\(|\.setUTCDate\(|\.setUTCMonth\(|\.setUTCFullYear\(|\.setDate\(|\.setMonth\(`;

/** Filtro de rango en una query de supabase-js. */
const FILTRO = String.raw`\.gte\(|\.lt\(|\.lte\(|\.gt\(`;

/**
 * Archivos EXENTOS, cada uno con su razón. Una exención sin razón es una
 * excepción disfrazada de regla; por eso van acá y no en un comentario suelto.
 */
const EXENTOS = new Map<string, string>([
  // — El helper y su base: son los que tienen derecho a construir instantes.
  ['apps/lifestyle/src/lib/timeWindows.ts',
   'ES el helper: acá vive la única aritmética de ventanas del repo'],
  ['apps/lifestyle/src/lib/dayWindow.ts',
   'la base tz-aware sobre la que timeWindows construye (zonedWallTimeToUtc)'],

  // — Motor de agenda: su aritmética es de SLOTS (hora de pared × duración),
  //   no de ventanas de reporte, y ya está probada aparte.
  ['packages/engine/src/bot/lifestyle/tzUtils.ts',
   'conversión hora-de-pared ↔ instante del motor de slots; su propia suite lo cubre'],
  ['packages/engine/src/scheduling/slots.ts',
   'genera slots de agenda (hora de pared × duración), no ventanas de reporte'],
  ['packages/engine/src/scheduling/appointments.ts',
   'idem: acota un día de agenda a partir de un Date ya resuelto por el caller'],
  ['packages/engine/src/scheduling/emergency.ts',
   'idem: acota un día de agenda a partir de un Date ya resuelto por el caller'],

  // — "Hace N días/horas desde AHORA": aritmética de INSTANTE, no de calendario.
  //   Restarle 21 días a un instante da el mismo resultado en cualquier zona
  //   horaria, así que no hay ventana de calendario que resolver.
  ['apps/lifestyle/src/app/api/customers/inactive/route.ts',
   'corte relativo "hace N días desde ahora": instante, no fecha de calendario'],
  ['apps/lifestyle/src/lib/atencionCount.ts',
   'idéntico al de inactivos: mismo corte relativo, para el badge de la fila plegada'],
  ['apps/lifestyle/src/lib/dashboard.types.ts',
   'getPeriodRange YA migró al helper; el Date crudo que queda es un corte relativo de 30 días'],
  ['apps/lifestyle/src/app/api/staff/block-request/route.ts',
   'mañana = hoy+1 para el default del formulario, y un corte relativo de 30 días'],

  // — Motor conversacional: fechas que el cliente dice, no ventanas de reporte.
  ['packages/engine/src/bot/lifestyle/scheduling.ts',
   'recorre días candidatos para ofrecer slots; su fecha ya viene resuelta en tz del negocio'],

  // — Dashboard legacy del engine (otro producto del monorepo, no lifestyle).
  ['packages/engine/src/dashboard/queries.ts',
   'dashboard del cliente médico, fuera del alcance de lifestyle; migra con su propio paso'],
]);

function grep(pattern: string): Set<string> {
  const out = new Set<string>();
  for (const tree of SOURCE_TREES) {
    let res = '';
    try {
      res = execFileSync(
        'git',
        ['grep', '-l', '--untracked', '-E', pattern, '--', tree],
        { encoding: 'utf8' },
      );
    } catch {
      // git grep sale con 1 cuando no hay coincidencias — no es un error.
      continue;
    }
    for (const line of res.split('\n')) if (line.trim()) out.add(line.trim());
  }
  return out;
}

test('★ ninguna ventana de consulta se arma con Date/UTC crudo', () => {
  const conCrudo  = grep(CRUDO);
  const conFiltro = grep(FILTRO);

  const infractores = [...conCrudo]
    .filter((f) => conFiltro.has(f))
    .filter((f) => !EXENTOS.has(f))
    .sort();

  assert.deepEqual(
    infractores,
    [],
    `Estos archivos arman una ventana con Date/UTC crudo Y filtran una query con ella:\n` +
    infractores.map((f) => `  · ${f}`).join('\n') +
    `\n\nUsa \`lib/timeWindows.ts\` (dayWindow / weekWindow / monthWindow / monthToDateWindow /\n` +
    `prevMonthTramoWindow), que resuelve los límites en la tz del NEGOCIO. Si el caso es\n` +
    `legítimo, agrégalo a EXENTOS en este archivo CON su razón escrita.`,
  );
});

test('las exenciones existen — una exención a un archivo borrado es ruido', () => {
  const faltantes = [...EXENTOS.keys()].filter((f) => {
    try { execFileSync('git', ['cat-file', '-e', `HEAD:${f}`], { stdio: 'ignore' }); return false; }
    catch {
      // Puede ser un archivo nuevo sin commitear: se acepta si existe en disco.
      try { execFileSync('test', ['-f', f]); return false; } catch { return true; }
    }
  });
  assert.deepEqual(faltantes, [], `exenciones a archivos que ya no existen: ${faltantes.join(', ')}`);
});

test('toda exención tiene una razón escrita, no una vacía', () => {
  for (const [archivo, razon] of EXENTOS) {
    assert.ok(razon.trim().length >= 20, `la exención de ${archivo} necesita una razón de verdad`);
  }
});
