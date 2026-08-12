// ─── Alta de cita del bot: por RPC atribuido, nunca por INSERT crudo ──────────
//
// RED del residuo de la Fase 2c-ii (S6-SEC-01). El audit de citas (migración 045)
// infiere `actor_type='bot'` SOLO en `INSERT source='bot'`, así que la cita de
// WALK-IN del bot (source='walkin') caía en 'unknown' — "Acción sin identificar" en
// la pestaña Actividad del dueño. La migración 056 mueve el alta a
// `bot_create_appointment`, que hace set_config del actor + INSERT en la misma
// transacción (mismo patrón de 047/048).
//
// Este test fija el CABLE: que el handler cree por RPC (con el source correcto en
// cada rama) y NO por `.insert()` a appointments — un futuro refactor de vuelta al
// insert crudo devolvería las walk-ins a 'unknown' en silencio. La atribución en sí
// ('bot' en la fila de audit) se prueba por ruta real contra la BD, no acá.
//
// Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleConfirmed } from '../packages/engine/src/bot/lifestyle/states/confirmed';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const CUST   = '99999999-9999-9999-9999-999999999999';
const APPT   = '00000000-0000-4000-8000-000000000001';

const NOW  = new Date('2026-07-06T15:00:00.000Z');           // lunes ~09:00 local
const SLOT = new Date('2026-07-07T17:00:00.000Z').toISOString(); // martes 11:00 local

// ─── Fake Supabase que GRABA cómo se creó la cita ─────────────────────────────
// Distingue las dos vías posibles: `.insert()` sobre appointments (la vieja, sin
// atribución) y `.rpc('bot_create_appointment')` (la de 056). El test asserta cuál
// se usó, así que el fake no puede "arreglar" ninguna de las dos.

type Row = Record<string, unknown>;
type RpcCall = { fn: string; args: Record<string, unknown> };

function makeSupabase(opts: { rpcError?: { code: string; message: string } } = {}) {
  const rpcCalls:   RpcCall[] = [];
  const apptInserts: Row[]    = [];

  const tables: Record<string, Row[]> = {
    customers: [{ id: CUST, name: 'Gabriel', phone: '5215500000000' }],
    services:  [{ id: SVC, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:     [{ id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001', staff_services: [{ service_id: SVC }] }],
    staff_services:            [{ staff_id: CARLOS, service_id: SVC }],
    appointments:              [],
    scheduled_notifications:   [],
  };

  const from = (table: string) => {
    const rows = tables[table] ?? (tables[table] = []);
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder, is: () => builder,
      gte: () => builder, gt: () => builder, lt: () => builder, lte: () => builder,
      neq: () => builder, not: () => builder, order: () => builder, limit: () => builder,
      insert: (payload: Row | Row[]) => {
        if (table === 'appointments') {
          for (const r of Array.isArray(payload) ? payload : [payload]) apptInserts.push(r);
        }
        return builder;
      },
      update: () => builder,
      upsert: () => builder,
      single:      () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: [...rows], error: null }),
    };
    return builder;
  };

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn !== 'bot_create_appointment') return { data: null, error: null };
    if (opts.rpcError) return { data: null, error: opts.rpcError };
    return { data: APPT, error: null };
  };

  return { client: { from, rpc } as never, rpcCalls, apptInserts };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDeps(supabase: never, tag: string) {
  return {
    business: {
      id:                    `biz-attr-${tag}`,   // único → aísla la cache del catálogo
      name:                  'Barbería Demo',
      whatsappNumber:        '5210000000000',
      whatsappPhoneNumberId: 'pnid-1',
      botName:               'Zlot',
      awayMessage:           'Cerrado.',
      fallbackMessage:       'Te comunico con el equipo.',
      officeHours:           null,
      walkInBufferMinutes:   60,
      address:               'Calle 1',
      timezone:              TZ,
    },
    supabase,
    anthropicKey: '',          // sin Anthropic → copy determinista de fallback
    model:        'haiku',
  } as never;
}

function makeMsg(): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  'Gabriel',
    body:          'Gabriel',
    messageId:     'wamid.attr',
    timestamp:     NOW,
  } as never;
}

function makeContext(isWalkIn: boolean): LifestyleBotContext {
  return {
    serviceId:    SVC,
    staffId:      CARLOS,
    customerId:   CUST,
    selectedSlot: SLOT,
    bookingName:  'Gabriel',
    ...(isWalkIn ? { isWalkIn: true } : {}),
  } as LifestyleBotContext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('alta normal del bot: crea por bot_create_appointment con source=bot, sin INSERT crudo', async () => {
  const { client, rpcCalls, apptInserts } = makeSupabase();
  const res = await handleConfirmed(makeMsg(), makeContext(false), makeDeps(client, 'bot'));

  const create = rpcCalls.filter((c) => c.fn === 'bot_create_appointment');
  assert.equal(create.length, 1, 'el alta debe pasar UNA vez por el RPC atribuido');
  assert.equal(create[0]!.args['p_source'], 'bot');
  assert.equal(create[0]!.args['p_staff_id'], CARLOS);
  assert.equal(create[0]!.args['p_service_id'], SVC);
  assert.equal(create[0]!.args['p_starts_at'], SLOT);
  assert.equal(create[0]!.args['p_booking_name'], 'Gabriel');

  assert.equal(apptInserts.length, 0, 'ningún INSERT crudo a appointments (perdería la atribución)');
  assert.equal(res.newState, 'CONFIRMED');
  assert.equal(res.newContext.appointmentId, APPT);
});

test('walk-in del bot: mismo RPC atribuido con source=walkin (el residuo de 2c-ii)', async () => {
  const { client, rpcCalls, apptInserts } = makeSupabase();
  const res = await handleConfirmed(makeMsg(), makeContext(true), makeDeps(client, 'walkin'));

  const create = rpcCalls.filter((c) => c.fn === 'bot_create_appointment');
  assert.equal(create.length, 1);
  assert.equal(create[0]!.args['p_source'], 'walkin');
  assert.equal(apptInserts.length, 0);
  assert.equal(res.newState, 'CONFIRMED');
});

test('conflicto de slot por el RPC (23P01): degrada a SHOWING_SLOTS, no inventa cita', async () => {
  const { client, apptInserts } = makeSupabase({
    rpcError: { code: '23P01', message: 'conflicting key value violates exclusion constraint' },
  });
  const res = await handleConfirmed(makeMsg(), makeContext(false), makeDeps(client, 'conflict'));

  assert.equal(res.newState, 'SHOWING_SLOTS');
  assert.match(res.responseText, /se acaba de ocupar/i);
  assert.equal(res.newContext.appointmentId, undefined);
  assert.equal(apptInserts.length, 0);
});
