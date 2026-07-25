// ─── Repo-check: el select de cita con joins es fuente única ─────────────────
// `DAY_APPOINTMENT_SELECT` / `STAFF_DAY_APPOINTMENT_SELECT` (dashboard.types.ts)
// son la ÚNICA definición de la forma `DashboardAppointment`. Si alguien copia el
// select en otro archivo, los dos DTOs se desincronizan en la primera migración
// — que es exactamente lo que este test impide.
//
// Qué fija:
//   1. El conjunto y el ORDEN de columnas y embeds de cada variante (pinneado acá,
//      así un cambio de forma tiene que ser deliberado y visible en el diff).
//   2. Que la única diferencia entre ambas variantes sea `completed_at`.
//   3. Que las dos queries consuman las constantes, no un literal suelto.
//   4. Que ningún OTRO archivo declare un select con esta forma.
//
// El whitespace NO se verifica a propósito: supabase-js borra todo espacio no
// entrecomillado del select antes de mandarlo (postgrest-js, `select()`), así que
// lo que viaja al cable depende solo del conjunto y el orden.
//
// Puro (sin DB, sin red): lee el fuente como texto — no lo importa, porque
// dashboard.types.ts usa el alias `@/` y arrastra el cliente de Supabase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'apps/lifestyle/src/lib/dashboard.types.ts';
const source = readFileSync(FILE, 'utf8');

// ── La forma esperada, pinneada ──────────────────────────────────────────────

const EXPECTED_SCALARS = [
  'id',
  'starts_at',
  'ends_at',
  'status',
  'source',
  'notes',
  'modified_at',
  'allow_overlap',
  'adjusted_starts_at',
  'late_arrival_acknowledged',
  'price_charged',
  'arrived_at',
];

const EXPECTED_EMBEDS = [
  'staff:staff_id(id, name)',
  'service:service_id(id, name, duration_minutes, price, currency)',
  'customer:customer_id(id, name, phone)',
  'created_by:created_by_staff_id(id, name)',
  'modified_by:modified_by_staff_id(id, name)',
];

function arrayOf(name: string): string[] {
  const m = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  assert.ok(m, `no encontré el array ${name} en ${FILE}`);
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

// ── 1. Conjunto y orden ──────────────────────────────────────────────────────

test('los escalares del select son los esperados, en orden', () => {
  assert.deepEqual(arrayOf('APPOINTMENT_SELECT_SCALARS'), EXPECTED_SCALARS);
});

test('los embeds del select son los esperados, en orden', () => {
  assert.deepEqual(arrayOf('APPOINTMENT_SELECT_EMBEDS'), EXPECTED_EMBEDS);
});

// ── 2. La única diferencia entre variantes es completed_at ───────────────────

test('la variante del barbero = la del negocio + completed_at, y nada más', () => {
  const scalars = arrayOf('APPOINTMENT_SELECT_SCALARS');
  const embeds = arrayOf('APPOINTMENT_SELECT_EMBEDS');
  const day = [...scalars, ...embeds];
  const staffDay = [...scalars, 'completed_at', ...embeds];

  assert.deepEqual(
    staffDay.filter((c) => !day.includes(c)),
    ['completed_at'],
    'la query del barbero agregó/quitó algo además de completed_at',
  );
  assert.deepEqual(
    day.filter((c) => !staffDay.includes(c)),
    [],
    'la query del negocio trae columnas que la del barbero no',
  );
  // completed_at va DESPUÉS de los escalares y ANTES de los embeds.
  assert.equal(staffDay.indexOf('completed_at'), scalars.length);
});

// ── 3. Las queries consumen las constantes ───────────────────────────────────

test('getDayAppointments y getStaffDayAppointments usan las constantes', () => {
  assert.match(source, /\.select\(DAY_APPOINTMENT_SELECT\)/);
  assert.match(source, /\.select\(STAFF_DAY_APPOINTMENT_SELECT\)/);
});

// ── 4. Nadie más declara un select con esta forma ────────────────────────────

test('el select con joins de cita vive SOLO en dashboard.types.ts', () => {
  // `modified_by:modified_by_staff_id(` es el marcador distintivo de esta forma:
  // ningún otro select del repo lo necesita.
  let hits: string[];
  try {
    const out = execFileSync(
      'git',
      [
        'grep', '--untracked', '-l', '-F', 'modified_by:modified_by_staff_id(',
        '--', 'apps/lifestyle/src', 'packages/engine/src',
      ],
      { encoding: 'utf8' },
    );
    hits = out.trim().split('\n').filter(Boolean);
  } catch (err) {
    // git grep sale con status 1 cuando no hay matches — eso no es un error.
    const e = err as { status?: number };
    if (e.status === 1) hits = [];
    else throw err;
  }

  assert.deepEqual(
    hits,
    [FILE],
    `El select de cita con joins se duplicó fuera de ${FILE} → ${hits.join(', ')}. ` +
      'Importá DAY_APPOINTMENT_SELECT / STAFF_DAY_APPOINTMENT_SELECT en vez de copiarlo.',
  );
});
