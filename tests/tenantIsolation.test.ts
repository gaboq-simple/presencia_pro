// ─── Tests de aislamiento multi-tenant (blindaje por código) ──────────────────
// Puros (sin DB real): un cliente Supabase FAKE en memoria que modela el filtrado
// de PostgREST (los .eq() se ANDean; select/update/insert/delete respetan los
// filtros). Dos negocios A y B seedeados. Se verifica que una operación atada al
// negocio A vía tenantDb() no puede LEER ni MUTAR datos de B.
//
// 🔴 Control negativo (el test tiene que poder fallar): una query CRUDA (sin el
// helper, sin .eq('business_id')) SÍ ve/muta datos de B → se asserta esa fuga. Eso
// prueba que el fake modela la fuga y que los tests del helper detectarían una
// regresión (si el helper dejara de inyectar el .eq, las aserciones de A fallarían).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { tenantDb, TENANT_TABLES } from '../apps/lifestyle/src/lib/tenantDb';

// ─── Fake Supabase client (modela PostgREST: eq/in se ANDean) ─────────────────

type Row = Record<string, unknown>;

function makeFakeClient(seed: Record<string, Row[]>) {
  const store: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(seed)) store[t] = rows.map((r) => ({ ...r }));

  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;

    const match = (row: Row) => filters.every((f) => f(row));

    function run() {
      store[table] = store[table] ?? [];
      if (op === 'select') return { data: store[table].filter(match), error: null };
      if (op === 'insert') {
        const rows = Array.isArray(payload) ? payload : [payload as Row];
        const copies = rows.map((r) => ({ ...r }));
        store[table].push(...copies);
        return { data: copies, error: null };
      }
      if (op === 'update') {
        const changed: Row[] = [];
        for (const row of store[table]) if (match(row)) { Object.assign(row, payload); changed.push(row); }
        return { data: changed, error: null };
      }
      // delete
      const removed = store[table].filter(match);
      store[table] = store[table].filter((r) => !match(r));
      return { data: removed, error: null };
    }

    const b: Record<string, unknown> = {
      select(_columns?: string, _opts?: unknown) { op = 'select'; return b; },
      insert(v: Row | Row[]) { op = 'insert'; payload = v; return b; },
      update(v: Row) { op = 'update'; payload = v; return b; },
      delete() { op = 'delete'; return b; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return b; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return b; },
      // thenable → `await` corre la query
      then(resolve: (v: { data: Row[]; error: null }) => void) { resolve(run()); },
    };
    return b;
  }

  return {
    _store: store,
    from(table: string) { return builder(table); },
  } as unknown as SupabaseClient & { _store: Record<string, Row[]> };
}

// ─── Seed: dos negocios A y B con filas en las 4 tablas del scope ─────────────

const A = 'biz-aaaaaaaa';
const B = 'biz-bbbbbbbb';

function freshSeed() {
  return {
    appointments: [
      { id: 'ap-A1', business_id: A, staff_id: 'st-A1', booking_name: 'Cliente A' },
      { id: 'ap-B1', business_id: B, staff_id: 'st-B1', booking_name: 'Cliente B' },
    ],
    customers: [
      { id: 'cu-A1', business_id: A, name: 'Ana (A)' },
      { id: 'cu-B1', business_id: B, name: 'Bruno (B)' },
    ],
    services: [
      { id: 'sv-A1', business_id: A, name: 'Corte A', price: 200 },
      { id: 'sv-B1', business_id: B, name: 'Corte B', price: 300 },
    ],
    staff: [
      { id: 'st-A1', business_id: A, name: 'Barbero A' },
      { id: 'st-B1', business_id: B, name: 'Barbero B' },
    ],
  };
}

const SCOPED_TABLES = ['appointments', 'customers', 'services', 'staff'] as const;

// ─── Lectura: A no ve nada de B ───────────────────────────────────────────────

for (const table of SCOPED_TABLES) {
  test(`SELECT vía tenantDb(A) sobre ${table} → solo filas de A, nunca de B`, async () => {
    const fake = makeFakeClient(freshSeed());
    const db = tenantDb(fake, A);
    const { data } = (await db.table(table).select('*')) as { data: Row[] };

    assert.ok(data.length > 0, 'debe traer al menos una fila de A');
    for (const row of data) {
      assert.equal(row['business_id'], A, `fuga: fila de otro negocio (${String(row['business_id'])}) en ${table}`);
    }
  });
}

// ─── Mutación: A no puede pisar datos de B ────────────────────────────────────

test('UPDATE vía tenantDb(A) sobre services no toca los de B', async () => {
  const fake = makeFakeClient(freshSeed());
  const db = tenantDb(fake, A);
  await db.table('services').update({ price: 999 });

  const svcB = fake._store['services']!.find((r) => r['id'] === 'sv-B1')!;
  const svcA = fake._store['services']!.find((r) => r['id'] === 'sv-A1')!;
  assert.equal(svcA['price'], 999, 'el servicio de A sí debe cambiar');
  assert.equal(svcB['price'], 300, 'FUGA: el servicio de B no debe cambiar');
});

test('DELETE vía tenantDb(A) sobre customers no borra los de B', async () => {
  const fake = makeFakeClient(freshSeed());
  const db = tenantDb(fake, A);
  await db.table('customers').delete().eq('id', 'cu-B1'); // intento malicioso: borrar un cliente de B

  const stillB = fake._store['customers']!.find((r) => r['id'] === 'cu-B1');
  assert.ok(stillB, 'FUGA: el cliente de B no debe borrarse (business_id AND id no matchean)');
});

test('INSERT vía tenantDb(A) fuerza business_id=A aunque el payload diga B', async () => {
  const fake = makeFakeClient(freshSeed());
  const db = tenantDb(fake, A);
  await db.table('services').insert({ id: 'sv-new', name: 'Nuevo', business_id: B }); // intento: insertar en B

  const inserted = fake._store['services']!.find((r) => r['id'] === 'sv-new')!;
  assert.equal(inserted['business_id'], A, 'el business_id del payload debe ser pisado por el del helper');
});

// ─── 🔴 Control negativo: el test PUEDE fallar ────────────────────────────────

test('control negativo: una query CRUDA (sin helper) SÍ ve datos de B — la fuga que el helper evita', async () => {
  const fake = makeFakeClient(freshSeed());

  // El "olvido": .from('appointments').select() SIN .eq('business_id') → ve A y B.
  const raw = (await (fake.from('appointments') as unknown as { select: () => Promise<{ data: Row[] }> }).select());
  const rawBizIds = new Set(raw.data.map((r) => r['business_id']));
  assert.ok(rawBizIds.has(B), 'el fake DEBE modelar la fuga: la query cruda ve datos de B');

  // El helper, sobre el MISMO fake, NO ve B → prueba que el guard corrige la fuga.
  const scoped = (await tenantDb(fake, A).table('appointments').select('*')) as { data: Row[] };
  const scopedBizIds = new Set(scoped.data.map((r) => r['business_id']));
  assert.ok(!scopedBizIds.has(B), 'el helper NO debe ver datos de B');
  assert.deepEqual([...scopedBizIds], [A]);
});

// ─── Sanidad: la lista de tablas de tenant es la esperada ─────────────────────

test('TENANT_TABLES cubre las 13 tablas con business_id', () => {
  assert.equal(TENANT_TABLES.length, 13);
  for (const t of SCOPED_TABLES) assert.ok(TENANT_TABLES.includes(t), `${t} debe estar en TENANT_TABLES`);
});
