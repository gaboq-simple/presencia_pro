// T7 — REPRO del bug de disponibilidad parcial (smoke R4.1), actualizado a Versión C.
// Síntoma: barbero fijo con día completo (slots en mañana Y tarde-noche); el cliente
// pide "¿qué horarios tienes?" sin pista → el bot ofrecía SOLO los 3 más tempranos
// (todos de la mañana), OCULTANDO la tarde/noche, y luego afirmaba "lo más cercano es
// 10" falsamente. Causa: slice(0,3) sobre slots cronológicos en scheduling.
//
// Versión C (la cura, sin preguntar franja): ante ambas franjas se ANCLA con una muestra
// representativa que abarca mañana Y tarde + "¿te late alguna o buscas otra?". La tarde
// NO se oculta. (Antes de Versión C la cura preguntaba "¿mañana o más tarde?"; eso se
// retiró.) ROJO→VERDE contra el código viejo: las anclas abarcan ambas franjas.
//
// Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleShowingSlots } from '../packages/engine/src/bot/lifestyle/states/presentingSlots';
import { noonUTCDate, weekdayFromDateStr, utcToLocalMinutes } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

const TZ       = 'America/Mexico_City';
const DATE_STR = '2026-06-10';
const DOW      = weekdayFromDateStr(DATE_STR);
const AFTERNOON_CUTOFF_MIN = 14 * 60;
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

test('T7 (bug repro, rojo→verde, Versión C): browse de barbero fijo con ambas franjas NO oculta la tarde — ancla con ejemplos de TODO el día', async () => {
  const r = await handleShowingSlots(makeMsg('¿qué horarios tienes?'), browseCtx(), makeDeps());

  // Versión C: en vez de volcar 3 de la mañana, ancla con ejemplos que abarcan mañana Y
  // tarde y deja la puerta abierta. VIEJO (slice): 3 slots tempranos, todos de mañana →
  // la aserción de "ancla de tarde" FALLA contra el código viejo.
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.ok(!r.newContext.pendingFranjaChoice, 'ya no pregunta la franja: ancla con ejemplos');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 0, 'fija las anclas representativas');
  const mins = ps.map((p) => utcToLocalMinutes(new Date(p.startsAt), TZ));
  assert.ok(mins.some((m) => m <  AFTERNOON_CUTOFF_MIN), 'incluye un ejemplo de la mañana');
  assert.ok(mins.some((m) => m >= AFTERNOON_CUTOFF_MIN), 'incluye un ejemplo de la tarde/noche (NO la oculta)');
  // Señal de amplitud honesta (ambas franjas) + puerta abierta.
  assert.match(r.responseText, /desde temprano hasta la noche/i);
  assert.match(r.responseText, /busca[rs]?\s+otra/i);
  // Ambas franjas: los ejemplos llevan marcador donde desambigua (extremos que enmarcan el
  // rango). "de la mañana" SOLO puede venir de un ejemplo — la frase de amplitud no lo dice.
  assert.match(r.responseText, /de la mañana/, 'el ejemplo de la mañana lleva su marcador (desambigua)');
});
