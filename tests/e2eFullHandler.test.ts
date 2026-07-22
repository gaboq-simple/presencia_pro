// ─── Deuda #1: e2e del happy-path por el HANDLER COMPLETO ─────────────────────
// El e2e existente (e2e-happyPath.test.ts) recorre el flujo vía dispatch(),
// encadenando newContext a mano. Este recorre handleLifestyleMessage — la
// costura load→dedup→dispatch→send→persist donde vivió el bug de S4-BOT-09 —
// con PERSISTENCIA REAL entre turnos: el upsert del turno N se aplica al fake
// y el turno N+1 lo lee y deserializa con Zod (round-trip completo del JSONB).
//
// Perfil del cliente fundador: negocio uni-barbero (ejercita el skip AUD-07c).
//   T1 "Quiero un corte de cabello" → QUALIFYING_DATETIME (barbero pre-asignado)
//   T2 "mañana"                     → SHOWING_SLOTS → CONFIRMING (lista de horas)
//   T3 "a las 10"                   → AWAITING_BOOKING_NAME
//   T4 "Gabriel"                    → CONFIRMED + INSERT real de la cita
//
// Classifier inyectado A NIVEL HANDLER (la DI nueva de esta deuda); send
// inyectado (AUD-05: enviar antes de persistir se ejercita de verdad).
// Determinista: sin red (anthropicKey '' → fallbacks deterministas).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleLifestyleMessage } from '../packages/engine/src/bot/lifestyle/handler';
import { parseDate } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import { weekdayFromDateStr, localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ  = 'America/Mexico_City';
// Reloj REAL: shouldResetConversation compara last_message contra Date.now(),
// así que los timestamps de los turnos deben ser "ahora" de verdad.
const NOW = new Date();

const SVC    = '22222222-2222-4222-8222-222222222222';
const CARLOS = '11111111-1111-4111-8111-111111111111';
const PHONE  = '5215500000000';

const REQ_DATE = parseDate('mañana', NOW, TZ)!;
const DOW      = weekdayFromDateStr(REQ_DATE);
// 10:00–11:30 con servicio de 30 min → exactamente 3 slots (10, 10:30, 11) →
// modo lista de la disponibilidad honesta, sin pregunta de franja.
const SLOT_10_UTC = localTimeToUTC(REQ_DATE, '10:00', TZ).toISOString();

// ─── Fake Supabase ESTATEFUL ──────────────────────────────────────────────────
// upsert/insert se APLICAN a las tablas (el turno siguiente los lee). Sin
// filtrado (una sola conversación/cliente) — forma heredada del e2e de dispatch.

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;

function makeSupabase(tables: TableData) {
  let seq = 0;
  // Ids sintéticos con forma de UUID v4 válido — el schema Zod del contexto
  // valida formato (en prod los genera la BD).
  const syntheticId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const from = (table: string) => {
    const rows = tables[table] ?? (tables[table] = []);
    let inserted: Row | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      gte: () => builder, gt: () => builder, lt: () => builder, lte: () => builder,
      neq: () => builder, not: () => builder, order: () => builder, limit: () => builder,
      is: () => builder,
      insert: (payload: Row | Row[]) => {
        const items = Array.isArray(payload) ? payload : [payload];
        for (const item of items) {
          seq += 1;
          const row = { id: syntheticId(seq), ...item };
          rows.push(row);
          inserted = row;
        }
        return builder;
      },
      update: () => builder,
      upsert: (payload: Row) => {
        // Semántica real de bot_conversations: UPSERT por customer_phone.
        const idx = rows.findIndex((r) => r['customer_phone'] === payload['customer_phone']);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
        else rows.push({ id: syntheticId(999), ...payload });
        return builder;
      },
      single:      () => Promise.resolve({ data: inserted ?? rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [...rows], error: null }),
    };
    return builder;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as never;
}

function tables(): TableData {
  return {
    customers: [],
    bot_conversations: [],
    services: [{ id: SVC, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff: [{ id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001', staff_services: [{ service_id: SVC }] }],
    staff_availability: [{
      staff_id: CARLOS, day_of_week: DOW,
      start_time: '10:00:00', end_time: '11:30:00',
      break_start: null, break_end: null,
    }],
    appointments: [],
    staff_blocks: [],
    staff_schedule_exceptions: [],
    staff_services: [{ staff_id: CARLOS, service_id: SVC }],
    scheduled_notifications: [],
    bot_logs: [],
  };
}

// Classifier inyectado a NIVEL HANDLER: solo el turno 1 usa el multi.
function makeClassifier() {
  return {
    classifyMultiIntent: async ({ userMessage }: { userMessage: string }): Promise<MultiIntentClassification> => {
      if (userMessage === 'Quiero un corte de cabello') {
        return { serviceMatch: { value: 'Corte de cabello', confidence: 1 } };
      }
      return { unclear: true };
    },
    classifyIntent: async () => ({ intent: 'UNCLEAR' as const, confidence: 0, value: null, side_question_answer: null }),
  } as never;
}

const business = {
  id:                    `biz-e2efh-${Math.floor(Math.PI * 1e6)}`,
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
} as never;

function makeMsg(body: string, n: number): never {
  return {
    businessId:    (business as { id: string }).id,
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     `wamid.t${n}`,
  } as never;
}

// ─── e2e ──────────────────────────────────────────────────────────────────────

test('full-handler: 4 turnos de WhatsApp → cita INSERTADA, con persistencia real entre turnos', async () => {
  const data     = tables();
  const supabase = makeSupabase(data);
  const sent: string[] = [];
  const send = async (text: string) => { sent.push(text); };
  const classifier = makeClassifier();

  const turn = (body: string, n: number) =>
    handleLifestyleMessage({ msg: makeMsg(body, n), business, supabase, anthropicKey: '', send, classifier });

  const convRow = () => data['bot_conversations']![0] as { state: string; context: Record<string, unknown>; last_message_id: string };

  // ── T1: pide el servicio → uni-barbero salta directo a la pregunta de día ──
  const r1 = await turn('Quiero un corte de cabello', 1);
  assert.equal(r1.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /qué día/i);
  assert.doesNotMatch(sent[0]!, /barbero de preferencia/);   // skip AUD-07c vivo
  assert.equal(convRow().state, 'QUALIFYING_DATETIME');
  assert.equal(convRow().context['staffId'], CARLOS);         // pre-asignado y PERSISTIDO
  assert.equal(convRow().context['serviceId'], SVC);
  assert.equal(convRow().last_message_id, 'wamid.t1');

  // ── T2: da el día → slots reales del día en el MISMO turno ────────────────
  const r2 = await turn('mañana', 2);
  assert.equal(r2.sent, true);
  assert.match(sent[1]!, /10/);                               // ofrece las horas reales
  assert.equal(convRow().state, 'CONFIRMING_APPOINTMENT');
  assert.equal(convRow().context['requestedDate'], REQ_DATE);
  const pending = convRow().context['pendingSlots'] as Array<{ startsAt: string }>;
  assert.ok(pending.length >= 1 && pending.length <= 3);

  // ── T3: elige hora → pregunta de nombre ───────────────────────────────────
  const r3 = await turn('a las 10', 3);
  assert.equal(r3.sent, true);
  assert.match(sent[2]!, /nombre/i);
  assert.equal(convRow().state, 'AWAITING_BOOKING_NAME');
  assert.equal(convRow().context['selectedSlot'], SLOT_10_UTC);

  // ── T4: da el nombre → CONFIRMED + INSERT real de la cita ─────────────────
  const r4 = await turn('Gabriel', 4);
  assert.equal(r4.sent, true);
  assert.match(sent[3]!, /confirmada|Gabriel/i);
  assert.equal(convRow().state, 'CONFIRMED');

  const appt = data['appointments']!.find((a) => a['status'] === 'confirmed');
  assert.ok(appt, 'la cita debe existir en la tabla');
  assert.equal(appt!['staff_id'], CARLOS);
  assert.equal(appt!['service_id'], SVC);
  assert.equal(appt!['starts_at'], SLOT_10_UTC);
  assert.equal(appt!['booking_name'], 'Gabriel');
  assert.equal(appt!['source'], 'bot');

  // ── Costura del handler verificada de punta a punta ───────────────────────
  // Historial acumulado (4 turnos × user+assistant) y ventana de dedup.
  const messages = convRow().context['messages'] as unknown[];
  assert.equal(messages.length, 8);
  assert.deepEqual(convRow().context['recent_message_ids'], ['wamid.t1', 'wamid.t2', 'wamid.t3', 'wamid.t4']);

  // Un retry del webhook de cualquier turno YA NO reprocesa (dedup por ventana).
  const before = data['appointments']!.length;
  const rRetry = await turn('a las 10', 3);
  assert.equal(rRetry.message, '');
  assert.equal(data['appointments']!.length, before);
});
