// ─── PIEZA 1 — "una sola voz" cuando el cliente da una hora ───────────────────
// Bug (doble-lista v2): greetCase 'full' encadena GREETING→SHOWING_SLOTS en el router
// (router.ts), que hace `.join` de la confirmación de saludo + la respuesta honesta de
// slots. Cuando el cliente dio una HORA, la respuesta honesta YA responde a esa hora
// ("A las 9 no tengo… tengo a las 10, 11 o 12"); anteponer "Corte con Carlos para
// mañana, anotado." produce DOS voces.
//
// Fix (greeting.ts): greeting suprime su confirmación (responseText '') cuando greetCase
// 'full' Y hay hora (pendingAgendaTime || requestedTime). El `.join` del router filtra
// strings vacíos → queda una sola voz. El cliente NUEVO conserva el aviso de privacidad
// (LFPDPPP Art. 8) — dato legal, no "voz" conversacional.
//
// rojo→verde: SIN el fix, greeting emite el fallback determinista "…anotado." y el join
// lo antepone → la aserción !includes('anotado') FALLA (dos voces). CON el fix, la
// confirmación queda fuera → pasa (una sola voz).
//
// Determinista: Supabase fake (sin red) + classifier inyectado; sin Anthropic
// (anthropicKey='' → los generadores caen a su fallback determinista).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { parseDate } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import { weekdayFromDateStr } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/types';

const TZ  = 'America/Mexico_City';
const NOW = new Date('2026-07-06T15:00:00.000Z'); // lunes ~09:00 local
const REQ_DATE = parseDate('mañana', NOW, TZ)!;
const DOW      = weekdayFromDateStr(REQ_DATE);

const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';

const BODY_HORA    = 'Corte con Carlos mañana a las 9'; // full + hora aparcada (9)
const BODY_SIN_HORA = 'Corte con Carlos mañana';        // full SIN hora (guarda)

// ─── Fake Supabase (builder encadenable y thenable) ──────────────────────────
type TableData = Record<string, unknown[]>;
function makeSupabase(tables: TableData) {
  let seq = 0;
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    let inserted: { id: string } | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      gte: () => builder, gt: () => builder, lt: () => builder, lte: () => builder,
      neq: () => builder, not: () => builder, order: () => builder, limit: () => builder,
      insert: () => { seq += 1; inserted = { id: `${table}-${seq}` }; return builder; },
      update: () => builder,
      single:      () => Promise.resolve({ data: inserted ?? rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

// Classifier: para el body de prueba devuelve servicio+barbero+fecha (→ greetCase
// 'full'). La HORA NO viene del classifier: la extrae el intérprete determinista en
// dispatch() desde "a las 9" → defer-agenda → pendingAgendaTime.
function makeClassifier() {
  return {
    classifyMultiIntent: async ({ userMessage }: { userMessage: string }): Promise<MultiIntentClassification> => {
      if (userMessage === BODY_HORA || userMessage === BODY_SIN_HORA) {
        return {
          serviceMatch: { value: 'Corte de cabello', confidence: 1 },
          staffMatch:   { value: 'Carlos', confidence: 1 },
          dateMatch:    { value: 'mañana', confidence: 1 },
        };
      }
      return { unclear: true };
    },
    classifyIntent: async () => ({ intent: 'UNCLEAR' as const, confidence: 0, value: null, side_question_answer: null }),
  };
}

function makeDeps(customers: unknown[]): never {
  const business = {
    id: `biz-sv-${customers.length}`, name: 'Barbería Demo',
    whatsappNumber: '5210000000000', whatsappPhoneNumberId: 'pnid-1',
    botName: 'Zlot', awayMessage: 'Cerrado.', fallbackMessage: 'Te comunico con el equipo.',
    officeHours: null, walkInBufferMinutes: 60, address: 'Calle 1', timezone: TZ,
  };
  const tables: TableData = {
    customers,
    services:  [{ id: SVC, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:     [{ id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001', staff_services: [{ service_id: SVC }] }],
    staff_availability: [{ staff_id: CARLOS, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null }],
    appointments: [], staff_blocks: [], staff_schedule_exceptions: [],
    staff_services: [{ staff_id: CARLOS, service_id: SVC }],
  };
  return { business, supabase: makeSupabase(tables), anthropicKey: '', model: 'haiku', classifier: makeClassifier() } as never;
}

function msg(body: string): never {
  return { businessId: 'biz', customerPhone: '5215500000000', customerName: 'Gabriel', body, timestamp: NOW, messageId: `wamid.${body}` } as never;
}

const RETURNING = [{ id: 'cust-1', name: 'Gabriel', favorite_staff_id: null, favorite_service_id: null, last_visit: null, favorite_staff: null, favorite_service: null }];

// ─── Tests ────────────────────────────────────────────────────────────────────

test('PIEZA 1 — cliente que vuelve: con hora, greeting NO antepone su confirmación (una sola voz)', async () => {
  const r = await dispatch('GREETING', msg(BODY_HORA), {}, makeDeps(RETURNING));
  // greetCase 'full' (servicio+barbero+fecha) + hora aparcada (9) → camino honesto.
  assert.equal(r.newContext.staffId, CARLOS, 'el barbero quedó fijado');
  // Una sola voz: la confirmación de saludo NO está. SIN el fix, "anotado" estaría.
  assert.ok(!r.responseText.includes('anotado'), 'no antepone la confirmación de greeting');
  // La respuesta honesta a la hora SÍ está.
  assert.ok(/no tengo disponible|tengo a las|tengo varios|por ejemplo/i.test(r.responseText), 'responde a la hora pedida');
  // Returning → no aplica aviso de privacidad.
  assert.ok(!r.responseText.includes('aviso de privacidad'), 'returning no recibe aviso de privacidad');
});

test('PIEZA 1 — cliente nuevo: con hora, una sola voz pero CONSERVA el aviso de privacidad (LFPDPPP)', async () => {
  const r = await dispatch('GREETING', msg(BODY_HORA), {}, makeDeps([]));
  assert.ok(!r.responseText.includes('anotado'), 'no antepone la confirmación de greeting');
  assert.ok(/no tengo disponible|tengo a las|tengo varios|por ejemplo/i.test(r.responseText), 'responde a la hora pedida');
  assert.ok(r.responseText.includes('aviso de privacidad'), 'cliente nuevo conserva el aviso de privacidad');
});

test('PIEZA 1 — guarda: greetCase full SIN hora conserva su confirmación (no se suprime de más)', async () => {
  const r = await dispatch('GREETING', msg(BODY_SIN_HORA), {}, makeDeps(RETURNING));
  assert.equal(r.newContext.staffId, CARLOS, 'el barbero quedó fijado');
  // Sin hora, el fix NO debe disparar: la confirmación de greeting se conserva.
  assert.ok(r.responseText.includes('anotado'), 'sin hora conserva la confirmación de greeting');
});
