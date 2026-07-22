// S5-BOT-08 — Corrección en el cierre (AWAITING_BOOKING_NAME).
// Dos capas:
//   1. detectsSummaryCorrection (detector puro) — la FRONTERA crítica: default
//      NOMBRE, solo corrige ante un marcador inequívoco. Los tests de "Carlos"
//      y "Abril" como nombres son los más importantes (cero regresión).
//   2. handleAwaitingBookingName (cableado) — el detector corre antes de la
//      captura de nombre; hora/día delegan, cancelar resetea, barbero se detecta
//      sin mis-guardar, y los nombres legítimos siguen capturándose.
//
// Deterministas: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleAwaitingBookingName } from '../packages/engine/src/bot/lifestyle/states/awaitingBookingName';
import { detectsSummaryCorrection } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ    = 'America/Mexico_City'; // UTC-6 fijo (México sin DST desde 2022)
const DATE  = '2026-06-15';          // lunes (DOW 1)
const DOW   = 1;
const NOW   = new Date('2026-06-15T15:00:00.000Z'); // lunes ~09:00 local
const STAFF = '11111111-1111-1111-1111-111111111111';
const SVC   = '22222222-2222-2222-2222-222222222222';

// ─── Fake Supabase (builder encadenable y thenable) ──────────────────────────

type TableData = Record<string, unknown[]>;

function makeSupabase(tablesData: TableData) {
  const from = (table: string) => {
    const data = tablesData[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      in:     () => builder,
      gte:    () => builder,
      lt:     () => builder,
      neq:    () => builder,
      order:  () => builder,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STAFF_ROW: StaffRow = { id: STAFF, name: 'Carlos', whatsapp_id: '5210000000000' };

function tables(): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [STAFF_ROW],
    staff_availability:        [{ staff_id: STAFF, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null }],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: STAFF }],
  };
}

let bizCounter = 0;
function makeDeps() {
  bizCounter += 1;
  const business = {
    id:                    `biz-${bizCounter}`, // único por test → aísla la cache del catálogo
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
  return { business, supabase: makeSupabase(tables()), anthropicKey: '', model: 'haiku' } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.test',
  } as never;
}

function localISO(localHHMM: string): string {
  return localTimeToUTC(DATE, localHHMM, TZ).toISOString();
}

function pslot(index: number, localHHMM: string, durMin = 30): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  const end   = new Date(start.getTime() + durMin * 60_000);
  return { index, staffId: STAFF, staffName: 'Carlos', startsAt: start.toISOString(), endsAt: end.toISOString() };
}

// {13:00, 14:00, 15:00} — "a las 2pm" (14:00) calza exacto → select.
const SLOTS = [pslot(1, '13:00'), pslot(2, '14:00'), pslot(3, '15:00')];

function ctxDirect(extra: Partial<LifestyleBotContext> = {}): LifestyleBotContext {
  // Caso B: sin pendingBookingName (entrada directa de nombre).
  return { serviceId: SVC, staffId: STAFF, autoAssign: false, requestedDate: DATE, pendingSlots: SLOTS, ...extra };
}

function ctxPrefilled(extra: Partial<LifestyleBotContext> = {}): LifestyleBotContext {
  // Caso A: con pendingBookingName esperando confirmación.
  return { ...ctxDirect(), pendingBookingName: 'Juan', ...extra };
}

function handle(body: string, ctx: LifestyleBotContext, deps: never) {
  return handleAwaitingBookingName(makeMsg(body), ctx, deps);
}

// ─── Detector puro: FRONTERA (lo crítico) ─────────────────────────────────────

test('detector: "Carlos" (cliente) → none (NO se confunde con corrección de barbero)', () => {
  assert.equal(detectsSummaryCorrection('Carlos', SLOTS, NOW, TZ).kind, 'none');
});

test('detector: "Abril" (cliente) → none (token de calendario solo, sin marcador)', () => {
  assert.equal(detectsSummaryCorrection('Abril', SLOTS, NOW, TZ).kind, 'none');
});

test('detector: "con Carlos" → barber (intento de cambio de barbero)', () => {
  assert.equal(detectsSummaryCorrection('con Carlos', SLOTS, NOW, TZ).kind, 'barber');
});

test('detector: "mejor con Carlos" → barber', () => {
  assert.equal(detectsSummaryCorrection('mejor con Carlos', SLOTS, NOW, TZ).kind, 'barber');
});

test('detector: "a las 2pm" → hour', () => {
  assert.equal(detectsSummaryCorrection('a las 2pm', SLOTS, NOW, TZ).kind, 'hour');
});

test('detector: "el martes no, el miércoles" → date (token + negación)', () => {
  assert.equal(detectsSummaryCorrection('el martes no, el miércoles', SLOTS, NOW, TZ).kind, 'date');
});

test('detector: "mejor el lunes" → date (token + verbo de corrección)', () => {
  assert.equal(detectsSummaryCorrection('mejor el lunes', SLOTS, NOW, TZ).kind, 'date');
});

test('detector: "lunes" solo → none (sin negación/verbo no dispara)', () => {
  assert.equal(detectsSummaryCorrection('lunes', SLOTS, NOW, TZ).kind, 'none');
});

test('detector: "ya no" → cancel', () => {
  assert.equal(detectsSummaryCorrection('ya no', SLOTS, NOW, TZ).kind, 'cancel');
});

test('detector: "olvídalo" → cancel', () => {
  assert.equal(detectsSummaryCorrection('olvídalo', SLOTS, NOW, TZ).kind, 'cancel');
});

test('detector: "no" pelado → none (lo consume el branch NO actual)', () => {
  assert.equal(detectsSummaryCorrection('no', SLOTS, NOW, TZ).kind, 'none');
});

test('detector: nombre legítimo "Juan Pablo García" → none', () => {
  assert.equal(detectsSummaryCorrection('Juan Pablo García', SLOTS, NOW, TZ).kind, 'none');
});

// ─── S5-BOT-08b: "con <token>" detecta barbero aunque NO esté en pendingSlots ──
// SLOTS = Carlos; aquí el cliente nombra a un barbero NO ofrecido (Andrés) o usa
// un genérico ("el otro"). "con" como PALABRA COMPLETA + token → barber. Frontera
// dura: "con" como prefijo de un nombre NUNCA dispara (Concepción/Conrado/Constanza).

test('detector S5-BOT-08b: "Con Carlos" (barbero NO ofrecido) → barber, NO corrompe nombre', () => {
  // cita con Andrés (slots distintos), pero probamos contra SLOTS=Carlos: el
  // patrón genérico "con <token>" dispara sin depender de pendingSlots.
  assert.equal(detectsSummaryCorrection('Con Carlos', [pslot(1, '13:00')], NOW, TZ).kind, 'barber');
});

test('detector S5-BOT-08b: "Con Andrés" (no está en slots de Carlos) → barber', () => {
  assert.equal(detectsSummaryCorrection('Con Andrés', SLOTS, NOW, TZ).kind, 'barber');
});

test('detector S5-BOT-08b: "con el otro" → barber', () => {
  assert.equal(detectsSummaryCorrection('con el otro', SLOTS, NOW, TZ).kind, 'barber');
});

test('detector S5-BOT-08b FRONTERA: "Concepción" → none (nombre válido, "con" es prefijo)', () => {
  assert.equal(detectsSummaryCorrection('Concepción', SLOTS, NOW, TZ).kind, 'none');
});

test('detector S5-BOT-08b FRONTERA: "Conrado" → none (nombre válido, "con" es prefijo)', () => {
  assert.equal(detectsSummaryCorrection('Conrado', SLOTS, NOW, TZ).kind, 'none');
});

test('detector S5-BOT-08b FRONTERA: "Constanza" → none (nombre válido, "con" es prefijo)', () => {
  assert.equal(detectsSummaryCorrection('Constanza', SLOTS, NOW, TZ).kind, 'none');
});

test('detector S5-BOT-08b FRONTERA: "Carlos" pelado → none (sin "con", no dispara)', () => {
  assert.equal(detectsSummaryCorrection('Carlos', SLOTS, NOW, TZ).kind, 'none');
});

// ─── Cableado: nombres legítimos siguen capturándose (cero regresión) ─────────

test('cliente llamado "Carlos" → se guarda como nombre (Caso B)', async () => {
  const r = await handle('Carlos', ctxDirect(), makeDeps());
  assert.equal(r.newState, 'CONFIRMED');
  assert.equal(r.newContext.bookingName, 'Carlos');
});

test('cliente llamado "Abril" → se guarda como nombre (Caso B)', async () => {
  const r = await handle('Abril', ctxDirect(), makeDeps());
  assert.equal(r.newState, 'CONFIRMED');
  assert.equal(r.newContext.bookingName, 'Abril');
});

test('nombre de 1-4 palabras "Juan Pablo García" → se guarda (Caso B)', async () => {
  const r = await handle('Juan Pablo García', ctxDirect(), makeDeps());
  assert.equal(r.newState, 'CONFIRMED');
  assert.equal(r.newContext.bookingName, 'Juan Pablo García');
});

test('S5-BOT-08b: cliente "Concepción" → se guarda como nombre (NO confundido con "con X")', async () => {
  const r = await handle('Concepción', ctxDirect(), makeDeps());
  assert.equal(r.newState, 'CONFIRMED');
  assert.equal(r.newContext.bookingName, 'Concepción');
});

// ─── Cableado: correcciones ───────────────────────────────────────────────────

test('"con Carlos" → NO se guarda como nombre; copy honesto sin prometer reagendar, con barbero actual interpolado', async () => {
  const r = await handle('con Carlos', ctxPrefilled(), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.bookingName, undefined);          // nunca corrupto
  // copy honesto (S5-BOT-08b): NO promete reagendar; ofrece confirmar con el
  // barbero actual (pendingSlots[0].staffName = "Carlos") o empezar de nuevo.
  assert.match(r.responseText, /no puedo cambiar de barbero/i);
  assert.match(r.responseText, /con Carlos/);                 // barbero actual interpolado
  assert.match(r.responseText, /empezar de nuevo/i);
  assert.doesNotMatch(r.responseText, /reagenda/i);           // ya no promete reagendamiento
});

test('"a las 2pm" → corrige la hora preservando barbero + día, delega en el mismo turno', async () => {
  const r = await handle('a las 2pm', ctxPrefilled(), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');          // select → buildConfirmationResult
  assert.equal(r.newContext.selectedSlot, localISO('14:00')); // hora corregida
  assert.equal(r.newContext.staffId, STAFF);                  // barbero preservado
  assert.equal(r.newContext.requestedDate, DATE);             // día preservado
});

test('"el martes no, el miércoles" → corrige el día (date_redirect → QUALIFYING_DATETIME)', async () => {
  const r = await handle('el martes no, el miércoles', ctxPrefilled(), makeDeps());
  assert.equal(r.newState, 'QUALIFYING_DATETIME');            // el router encadena → SHOWING_SLOTS
  assert.equal(r.newContext.serviceId, SVC);                  // servicio preservado
  assert.equal(r.newContext.staffId, STAFF);                  // barbero preservado
});

test('"ya no" → cancela y va a GREETING (sin tocar BD), preserva customerId', async () => {
  const customerId = '33333333-3333-3333-3333-333333333333';
  const r = await handle('ya no', ctxPrefilled({ customerId }), makeDeps());
  assert.equal(r.newState, 'GREETING');
  assert.equal(r.newContext.customerId, customerId);
});

// ─── Coexistencia S5-BOT-03: rejection_attempts intacto ───────────────────────

test('corrección de barbero NUNCA toca rejection_attempts', async () => {
  const r = await handle('con Carlos', ctxPrefilled({ rejection_attempts: 2 }), makeDeps());
  assert.equal(r.newContext.rejection_attempts, 2);
});

// ─── Caso A: "no" pelado mantiene su semántica actual ─────────────────────────

test('"no" pelado en Caso A → rechaza el nombre pre-llenado (semántica actual)', async () => {
  const r = await handle('no', ctxPrefilled(), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.pendingBookingName, null);        // limpia el pre-llenado
  assert.match(r.responseText, /A nombre de qui[eé]n/i);
});

test('"sí" en Caso A → confirma el pre-llenado (un sí es confirmación, no corrección)', async () => {
  const r = await handle('sí', ctxPrefilled(), makeDeps());
  assert.equal(r.newState, 'CONFIRMED');
  assert.equal(r.newContext.bookingName, 'Juan');
});
