// ─── Caracterización del estado CONFIRMED — bot cancela / re-confirma / retraso ──
//
// RED de 2c-ii: fija el COMPORTAMIENTO ACTUAL de handleConfirmationResponse en sus
// tres ramas mutantes ANTES de mover los .update() a RPCs con atribución. La prueba
// asserta el CONTRATO invariante del FSM (newState + responseText + degradación), que
// debe quedar BYTE-IDÉNTICO antes y después del cableado de 2c-ii. La atribución
// ('bot' en el audit) se prueba por ruta real, no acá — acá solo se blinda que 2c-ii
// NO cambió el comportamiento.
//
// "Mutación" (mechanism-tolerant): un UPDATE a appointments (código de hoy) o un RPC
// bot_*/mark_* (código post-2c-ii). El RPC de solo-lectura check_late_arrival_
// feasibility NO cuenta como mutación. Así el MISMO test corre idéntico en ambos lados.
//
// Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleConfirmationResponse } from '../packages/engine/src/bot/lifestyle/states/confirmationResponse';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const STAFF  = '11111111-1111-1111-1111-111111111111';
const SVC    = '22222222-2222-2222-2222-222222222222';
const CUST   = '99999999-9999-9999-9999-999999999999';
const APPT   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ─── Fake Supabase que GRABA mutaciones ──────────────────────────────────────
// Soporta: customers/appointments/waitlist read (maybeSingle), appointments update
// (grabado + thenable success), y rpc (grabado; feasibility devuelve el fixture).

type FeasibilityResult = {
  feasible:               boolean;
  reason:                 string;
  adjusted_start:         string | null;
  adjusted_end:           string | null;
  next_appointment_start: string | null;
};

type Recorder = {
  updates: { table: string; payload: Record<string, unknown> }[];
  rpcs:    { name: string; args: unknown }[];
};

function makeRecordingSupabase(opts: {
  customer:    { id: string } | null;
  appt:        unknown | null;
  feasibility: FeasibilityResult | null;
}): { supabase: never; rec: Recorder } {
  const rec: Recorder = { updates: [], rpcs: [] };

  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      in:     () => builder,
      gte:    () => builder,
      gt:     () => builder,
      lt:     () => builder,
      lte:    () => builder,
      neq:    () => builder,
      not:    () => builder,
      order:  () => builder,
      limit:  () => builder,
      update: (payload: Record<string, unknown>) => {
        rec.updates.push({ table, payload });
        return builder;
      },
      maybeSingle: () => {
        if (table === 'customers')    return Promise.resolve({ data: opts.customer, error: null });
        if (table === 'appointments') return Promise.resolve({ data: opts.appt,     error: null });
        return Promise.resolve({ data: null, error: null }); // waitlist u otros
      },
      // Awaited directo (p. ej. el .update().eq()): resuelve éxito.
      then: (resolve: (v: { data: null; error: null }) => void) =>
        resolve({ data: null, error: null }),
    };
    return builder;
  };

  const rpc = (name: string, args: unknown) => {
    rec.rpcs.push({ name, args });
    if (name === 'check_late_arrival_feasibility') {
      return Promise.resolve({ data: opts.feasibility ? [opts.feasibility] : null, error: null });
    }
    // RPCs de mutación de 2c-ii (bot_set_appointment_status / bot_apply_late_arrival):
    // devuelven éxito con shape { data, error } idéntico al de .update().
    return Promise.resolve({ data: null, error: null });
  };

  return { supabase: { from, rpc } as never, rec };
}

// "Mutación" real de la cita: UPDATE a appointments (hoy) o RPC bot_*/mark_* (2c-ii).
function mutationCount(rec: Recorder): number {
  const updates = rec.updates.filter((u) => u.table === 'appointments').length;
  const rpcMut  = rec.rpcs.filter((r) => r.name.startsWith('bot_') || r.name.startsWith('mark_')).length;
  return updates + rpcMut;
}

// ─── Deps / msg / fixtures ────────────────────────────────────────────────────

let bizCounter = 0;
function makeDeps(supabase: never) {
  bizCounter += 1;
  const business = {
    id:                    `biz-char-${bizCounter}`,
    name:                  'Barbería Demo',
    whatsappNumber:        '5210000000000',
    whatsappPhoneNumberId: 'pnid-1',
    botName:               'Asistente',
    awayMessage:           'Cerrado.',
    fallbackMessage:       'Te comunico con el equipo.',
    officeHours:           null,
    walkInBufferMinutes:   60,
    address:               'Calle 1',
    timezone:              TZ,
  };
  const classifier = {
    classifyIntent:      async () => ({ intent: 'UNCLEAR' as const, confidence: 0, value: null, side_question_answer: null }),
    classifyMultiIntent: async () => ({ unclear: true }),
  };
  return { business, supabase, classifier, anthropicKey: '', model: 'haiku' } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  null,
    body,
    timestamp:     new Date(),
    messageId:     'wamid.char',
  } as never;
}

// Cita próxima (dentro de las 3h) — staff.whatsapp_id vacío → no dispara envíos WA.
function apptRow(startsAt: string) {
  return {
    id:        APPT,
    starts_at: startsAt,
    staff:     { id: STAFF, name: 'Carlos', whatsapp_id: '' },
    service:   { name: 'Corte' },
    customer:  { id: CUST, name: 'Ana' },
  };
}

function inMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

const CTX: LifestyleBotContext = { messages: [] } as unknown as LifestyleBotContext;

// ─── Rama 1: bot CANCELA (keyword negativo) ───────────────────────────────────

test('CONFIRMED/cancel: "cancelar" → COMPLETED + texto de cancelación + 1 mutación', async () => {
  const { supabase, rec } = makeRecordingSupabase({
    customer: { id: CUST }, appt: apptRow(inMinutes(90)), feasibility: null,
  });
  const r = await handleConfirmationResponse(makeMsg('cancelar'), CTX, makeDeps(supabase));

  assert.ok(r, 'debe manejar el mensaje (no null)');
  assert.equal(r!.newState, 'COMPLETED');
  assert.equal(r!.responseText, 'Entendido, cancelamos tu cita. Cuando quieras reagendar aquí estamos.');
  assert.equal(mutationCount(rec), 1, 'exactamente una mutación de la cita');
});

// ─── Rama 2: bot RE-CONFIRMA (keyword positivo) ───────────────────────────────

test('CONFIRMED/confirm: "confirmo" → CONFIRMED + texto de confirmación + 1 mutación', async () => {
  const { supabase, rec } = makeRecordingSupabase({
    customer: { id: CUST }, appt: apptRow(inMinutes(90)), feasibility: null,
  });
  const r = await handleConfirmationResponse(makeMsg('confirmo'), CTX, makeDeps(supabase));

  assert.ok(r);
  assert.equal(r!.newState, 'CONFIRMED');
  assert.match(r!.responseText, /^Perfecto! Te esperamos a las .+ con Carlos\.$/);
  assert.equal(mutationCount(rec), 1);
});

// ─── Rama 3a: bot aplica RETRASO factible ─────────────────────────────────────

test('CONFIRMED/late feasible: "llego 10 minutos tarde" → CONFIRMED + confirma nueva hora + 1 mutación', async () => {
  const { supabase, rec } = makeRecordingSupabase({
    customer: { id: CUST },
    appt:     apptRow(inMinutes(90)),
    feasibility: {
      feasible: true, reason: 'OK',
      adjusted_start: inMinutes(100), adjusted_end: inMinutes(130),
      next_appointment_start: null,
    },
  });
  const r = await handleConfirmationResponse(makeMsg('llego 10 minutos tarde'), CTX, makeDeps(supabase));

  assert.ok(r);
  assert.equal(r!.newState, 'CONFIRMED');
  assert.match(r!.responseText, /^Sin problema! Te esperamos a las /);
  // INVARIANTE (idéntico antes/después de 2c-ii): la feasibility SIEMPRE se llama con
  // el appointment + los minutos. La APLICACIÓN del ajuste vive: antes → en un UPDATE
  // externo; después → dentro de este mismo RPC (server-side, no observable por el
  // cliente). Por eso NO se asserta mutationCount acá — el write se prueba por ruta
  // real (audit muestra adjusted + 'bot'). El contrato del FSM (state+texto) es lo
  // que este test blinda.
  const feas = rec.rpcs.filter((x) => x.name === 'check_late_arrival_feasibility');
  assert.equal(feas.length, 1);
  assert.deepEqual(feas[0]!.args, { p_appointment_id: APPT, p_delay_minutes: 10 });
});

// ─── Rama 3b: retraso INFACTIBLE (traslape) — degradación sin mutar ────────────

test('CONFIRMED/late overlap: infactible → CONFIRMED + prompt de reagenda + CERO mutación', async () => {
  const { supabase, rec } = makeRecordingSupabase({
    customer: { id: CUST },
    appt:     apptRow(inMinutes(90)),
    feasibility: {
      feasible: false, reason: 'El retraso causaria traslape con la siguiente cita',
      adjusted_start: inMinutes(100), adjusted_end: inMinutes(130),
      next_appointment_start: inMinutes(110),
    },
  });
  const r = await handleConfirmationResponse(makeMsg('llego 10 minutos tarde'), CTX, makeDeps(supabase));

  assert.ok(r);
  assert.equal(r!.newState, 'CONFIRMED');
  assert.match(r!.responseText, /se traslaparía/);
  assert.equal(mutationCount(rec), 0, 'infactible NO debe mutar la cita');
});

// ─── Guarda: sin cita próxima → null (cae al router normal) ────────────────────

test('CONFIRMED/sin cita próxima: retorna null (no intercepta)', async () => {
  const { supabase } = makeRecordingSupabase({ customer: { id: CUST }, appt: null, feasibility: null });
  const r = await handleConfirmationResponse(makeMsg('cancelar'), CTX, makeDeps(supabase));
  assert.equal(r, null);
});
