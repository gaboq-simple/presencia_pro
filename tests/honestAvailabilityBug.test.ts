// T7 — REPRO del bug de disponibilidad parcial (smoke R4.1).
// Síntoma: barbero fijo con día completo (slots en mañana Y tarde-noche); el cliente
// pide "¿qué horarios tienes?" sin pista → el bot ofrecía SOLO los 3 más tempranos
// (todos de la mañana), OCULTANDO la tarde/noche, y luego afirmaba "lo más cercano es
// 10" falsamente. Causa: slice(0,3) sobre slots cronológicos en scheduling.
//
// Este test importa SOLO handleShowingSlots (existe en el código viejo y el nuevo),
// para poder correrlo contra ambos y confirmar ROJO→VERDE:
//   - VIEJO (con slice): vuelca 3 slots → newState = CONFIRMING_APPOINTMENT,
//     pendingFranjaChoice undefined, los 3 pendingSlots son todos de la mañana.
//   - NUEVO (forma honesta): no oculta la tarde → pregunta la franja binaria →
//     newState = SHOWING_SLOTS con pendingFranjaChoice = true.
//
// Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleShowingSlots } from '../packages/engine/src/bot/lifestyle/states/presentingSlots';
import { noonUTCDate, weekdayFromDateStr } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

const TZ       = 'America/Mexico_City';
const DATE_STR = '2026-06-10';
const DOW      = weekdayFromDateStr(DATE_STR);
const SVC      = 'svc-corte';
const STAFF: StaffRow = { id: 'staff-carlos', name: 'Carlos', whatsapp_id: '5210000000000' };

type TableData = Record<string, unknown[]>;
function makeSupabase(tables: TableData) {
  const from = (table: string) => {
    const data = tables[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder, gte: () => builder,
      lt: () => builder, neq: () => builder, order: () => builder, limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

// Día COMPLETO 10:00–20:00 → muchos slots en ambas franjas (mañana y tarde-noche).
function fullDayTables(): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [STAFF],
    staff_availability:        [{ staff_id: STAFF.id, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null }],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: STAFF.id }],
  };
}

function makeDeps(): never {
  return {
    business: {
      id: 'biz-bug', name: 'Barbería Demo', whatsappNumber: '5210000000000',
      whatsappPhoneNumberId: 'pnid-1', botName: 'Asistente', awayMessage: 'Cerrado.',
      fallbackMessage: 'Te comunico con el equipo.', officeHours: null, walkInBufferMinutes: 60,
      address: 'Calle 1', timezone: TZ,
    },
    supabase: makeSupabase(fullDayTables()), anthropicKey: '', model: 'haiku',
  } as never;
}

function makeMsg(body: string): never {
  return { businessId: 'biz', customerPhone: '5215500000000', customerName: null, body, timestamp: new Date('2026-06-10T15:00:00Z'), messageId: 'wamid.bug' } as never;
}

// Barbero FIJO (staffId set, autoAssign falso), día pedido, SIN pista de hora/franja.
function browseCtx(): LifestyleBotContext {
  return { serviceId: SVC, staffId: STAFF.id, autoAssign: false, requestedDate: DATE_STR };
}

test('T7 (bug repro, rojo→verde): browse de barbero fijo con ambas franjas NO oculta la tarde — pregunta franja, no vuelca 3 tempranos', async () => {
  const r = await handleShowingSlots(makeMsg('¿qué horarios tienes?'), browseCtx(), makeDeps());

  // NUEVO (forma honesta): no se queda con 3 de la mañana → pregunta la franja.
  // VIEJO (slice): habría ido a CONFIRMING_APPOINTMENT con 3 slots tempranos y
  // pendingFranjaChoice undefined → estas aserciones FALLAN contra el código viejo.
  assert.equal(r.newState, 'SHOWING_SLOTS', 'no debe volcar slots: debe preguntar la franja');
  assert.equal(r.newContext.pendingFranjaChoice, true, 'pregunta binaria de franja (ambas con slots)');
  // No se fijaron pendingSlots a ciegas (no se eligió subconjunto todavía).
  assert.ok((r.newContext.pendingSlots ?? []).length === 0, 'no fija pendingSlots antes de saber la franja');
});
