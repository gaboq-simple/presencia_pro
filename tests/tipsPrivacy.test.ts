// ─── Repo-check: privacidad de propinas (Paso 7 rediseño barbero) ─────────────
// La propina es PRIVADA del dueño/asistente. El aislamiento es estructural: tabla
// aparte `appointment_tips` (el Realtime del dueño escucha `appointments` y no la
// emite) + lint eslint (allowlist barbero). Este test lo respalda repo-wide con un
// grep real: ninguna referencia a appointment_tips/tipAmount fuera del módulo
// barbero — cubre lo que el lint no alcanza (packages/engine completo, strings en
// template literals, archivos nuevos fuera de los globs).
//
// Puro (sin DB): usa `git grep` sobre los árboles de código fuente. --untracked
// para que los archivos aún no commiteados también cuenten.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const SOURCE_TREES = ['apps/lifestyle/src', 'packages/engine/src'];

// La allowlist ES la regla de privacidad: el módulo barbero, y nada más.
const ALLOWED_FILES = new Set([
  'apps/lifestyle/src/lib/barberDay.ts', // read barbero-only (único select)
  'packages/engine/src/tenantDb.ts',     // la tabla en TENANT_TABLES (guard, no query)
]);
// El árbol de la vista barbero: la ruta /staff (page + actions, con
// setAppointmentTip y el refresh) y su UI (display/captura).
const ALLOWED_PREFIXES = [
  'apps/lifestyle/src/app/staff/',
  'apps/lifestyle/src/components/staff/',
];

function grepFiles(pattern: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['grep', '--untracked', '-l', '-E', pattern, '--', ...SOURCE_TREES],
      { encoding: 'utf8' },
    );
    return out.trim().split('\n').filter(Boolean);
  } catch (err) {
    // git grep sale con status 1 cuando no hay matches — eso no es un error.
    const e = err as { status?: number };
    if (e.status === 1) return [];
    throw err;
  }
}

test('appointment_tips/tipAmount viven SOLO en el módulo barbero', () => {
  const hits = grepFiles('appointment_tips|tipAmount');
  const leaks = hits.filter(
    (f) => !ALLOWED_FILES.has(f) && !ALLOWED_PREFIXES.some((p) => f.startsWith(p)),
  );
  assert.deepEqual(
    leaks,
    [],
    `Fuga de privacidad de propinas: referencias fuera del módulo barbero → ${leaks.join(', ')}`,
  );
});

test('árbol admin/dashboard/reports limpio de propinas', () => {
  const hits = grepFiles('appointment_tips|tipAmount|tip_amount');
  const forbidden = hits.filter(
    (f) =>
      f.includes('/components/admin/') ||
      f.includes('/app/dashboard/') ||
      f.includes('/api/reports/'),
  );
  assert.deepEqual(forbidden, [], `Propinas en el árbol del dueño: ${forbidden.join(', ')}`);
});

// 🔴 Control negativo (el test tiene que poder fallar): el grep DEBE encontrar el
// módulo barbero. Si dejara de encontrarlo, las aserciones de arriba pasarían en
// vacío y no probarían nada.
test('control negativo: el grep encuentra el módulo barbero', () => {
  const hits = grepFiles('appointment_tips');
  assert.ok(
    hits.includes('apps/lifestyle/src/lib/barberDay.ts'),
    'barberDay.ts debe referenciar appointment_tips (si no, el grep está roto)',
  );
  assert.ok(
    hits.includes('apps/lifestyle/src/app/staff/actions.ts'),
    'staff/actions.ts debe referenciar appointment_tips (si no, el grep está roto)',
  );
});
