// ─── computeDayRevenue: el embed de servicio puede faltar ────────────────────
// `appointments.service_id` es NULL-able en la BD, así que el join puede venir
// vacío. El tipo `DashboardAppointment.service` lo declara no-nullable sobre una
// hidratación por cast, o sea que TypeScript NO avisa — el único que puede
// avisar es este test.
//
// Por qué importa que sea un 500 y no un número mal: la llama
// `app/dashboard/page.tsx`, un Server Component. Un throw ahí deja la pestaña
// Administrar del dueño sin cargar.
//
// Puro: importa `lib/dayRevenue.ts`, que no toca la BD ni el alias `@/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDayRevenue } from '../apps/lifestyle/src/lib/dayRevenue';
import type { DashboardAppointment } from '../apps/lifestyle/src/lib/dashboard.types';

/** Cita completada mínima. `service` se pasa aparte para poder anularlo. */
function cita(
  priceCharged: number | null,
  service: { price: number; currency: string } | null,
): DashboardAppointment {
  return {
    id: `a-${priceCharged}-${service ? service.price : 'nil'}`,
    starts_at: '2026-09-02T16:00:00.000Z',
    ends_at: '2026-09-02T16:30:00.000Z',
    status: 'completed',
    source: 'manual',
    notes: null,
    staff: { id: 's1', name: 'Carlos' },
    // El cast es el punto: así llega la fila real, y así es como el tipo miente.
    service: (service
      ? { id: 'sv1', name: 'Corte', duration_minutes: 30, ...service }
      : null) as DashboardAppointment['service'],
    customer: null,
    created_by: null,
    modified_by: null,
    modified_at: null,
    allow_overlap: false,
    adjusted_starts_at: null,
    late_arrival_acknowledged: false,
    price_charged: priceCharged,
    arrived_at: null,
  } as DashboardAppointment;
}

const MXN = (price: number) => ({ price, currency: 'MXN' });

// ── El defecto: sin servicio, la función reventaba ───────────────────────────

test('cita sin servicio pero con precio sellado: vale su precio, no revienta', () => {
  const r = computeDayRevenue([cita(320, null)]);
  assert.equal(r.total, 320, 'el precio sellado es el hecho; el embed es metadata del catálogo');
  assert.equal(r.completedCount, 1);
});

// ⚠️ NO BORRAR SIN REEMPLAZO: es la ÚNICA aserción que sostiene el defecto
// original de `dashboard.types.ts:567` (`a.service.price` sin `?.`). Con un sello
// presente, el `??` corta ANTES de tocar `a.service.price`, así que la cita con
// precio nunca reventaba: el crash sólo ocurre cuando faltan los dos. Verificado
// por mutación — al quitar el guard del monto, de los siete tests de este archivo
// falla éste y ningún otro. Si desaparece, el bug vuelve con la suite en verde.
test('ÚNICO GUARDIÁN del defecto 567 — sin servicio y sin sello: aporta 0, no revienta', () => {
  const r = computeDayRevenue([cita(null, null)]);
  assert.equal(r.total, 0, 'sin ningún precio del que hablar, 0 es lo único honesto');
  assert.equal(r.completedCount, 1, 'la cita se cuenta igual: existió');
});

test('la primera cita sin servicio no revienta al resolver la moneda', () => {
  // `completed[0]?.service.currency` tenía `?.` sobre el ÍNDICE, no sobre el
  // embed: con la primera cita sin servicio, esta línea reventaba aparte.
  const r = computeDayRevenue([cita(320, null), cita(200, MXN(200))]);
  assert.equal(r.currency, 'MXN');
  assert.equal(r.total, 520);
});

// ── Lo que NO cambia: el fallback al precio de lista es de P1 ────────────────

test('con servicio y sin sello, sigue cayendo al precio de lista', () => {
  const r = computeDayRevenue([cita(null, MXN(250))]);
  assert.equal(r.total, 250);
});

test('el sello le gana al precio de lista vigente', () => {
  const r = computeDayRevenue([cita(180, MXN(250))]);
  assert.equal(r.total, 180, 'editar el catálogo no reescribe la historia (049)');
});

test('sólo suman las completadas', () => {
  const pendiente = { ...cita(999, MXN(999)), status: 'pending' as const };
  const r = computeDayRevenue([cita(100, MXN(100)), pendiente]);
  assert.equal(r.total, 100);
  assert.equal(r.completedCount, 1);
});

test('día sin citas: 0 y moneda por defecto', () => {
  const r = computeDayRevenue([]);
  assert.deepEqual(r, { total: 0, currency: 'MXN', completedCount: 0 });
});
