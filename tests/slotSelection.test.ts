// S5-BOT — Tests del ruteo de selección de slot en lenguaje natural.
// Puros y deterministas: sin red, sin Supabase, sin Anthropic.
// Ejecutar: npm test
//
// Cubre las 6 decisiones de diseño + la regla maestra de ruteo + regresiones:
//   (a) hora exacta entre slots          (b) hora válida NO ofrecida → cercana
//   (c) ordinales                        (d) selección difusa
//   (e) índice numérico como fallback    (f) AM/PM desambiguado contra slots
// Regresiones: "mañana a las 5" sigue al date-flow; "cualquiera"→primero;
//   "2" / "uno" siguen funcionando; texto de corrección de servicio NO se
//   malinterpreta como selección (lo intercepta el handler antes del ruteo).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeSlotSelection,
  type SelectionRoute,
} from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import type { LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';

const TZ  = 'America/Mexico_City'; // UTC-6 fijo (México sin DST desde 2022)
const NOW = new Date('2026-06-12T12:00:00.000Z'); // viernes
const STAFF = '11111111-1111-1111-1111-111111111111';

// Helper: México es UTC-6 → hora local + 6 = hora UTC del mismo día.
function slot(index: number, localHHMM: string, durMin = 30): LifestylePendingSlot {
  const [h, m] = localHHMM.split(':').map(Number) as [number, number];
  const startUtcH = h + 6; // -(-6)
  const startsAt  = `2026-06-15T${String(startUtcH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
  const end       = new Date(new Date(startsAt).getTime() + durMin * 60_000).toISOString();
  return { index, staffId: STAFF, staffName: 'Carlos', startsAt, endsAt: end };
}

// Tres slots de la tarde: 16:45 / 17:00 / 17:15
const afternoon = [slot(1, '16:45'), slot(2, '17:00'), slot(3, '17:15')];
// Tres slots de la mañana: 09:00 / 10:00 / 11:00
const morning = [slot(1, '09:00'), slot(2, '10:00'), slot(3, '11:00')];
// Mixto: una de la mañana y una de la tarde
const mixed = [slot(1, '10:00'), slot(2, '17:00')];

function route(body: string, slots = afternoon): SelectionRoute {
  return routeSlotSelection(body, slots, NOW, TZ);
}

// ─── (a) Hora exacta entre los slots ──────────────────────────────────────────

test('(a) "5 de la tarde" selecciona el slot de las 17:00', () => {
  const r = route('5 de la tarde');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:00:00.000Z');
});

test('(a) "el de las 5" selecciona el slot de las 17:00', () => {
  const r = route('el de las 5');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:00:00.000Z');
});

test('(a) "5pm" selecciona el slot de las 17:00', () => {
  const r = route('5pm');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:00:00.000Z');
});

test('(a) "a las 5:15" selecciona el slot de las 17:15', () => {
  const r = route('a las 5:15');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:15:00.000Z');
});

test('(a) hora dentro de tolerancia: "5:03" cae al slot 17:00 (±5 min)', () => {
  const r = route('a las 5:03');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:00:00.000Z');
});

// ─── (b) Hora válida pero NO ofrecida → ofrecer la más cercana ────────────────

test('(b) "a las 6" (no ofrecida) ofrece el slot más cercano SIN re-rutear', () => {
  const r = route('a las 6');
  assert.equal(r.action, 'offer_nearest');
  const o = r as { requestedMinutes: number; slot: LifestylePendingSlot };
  assert.equal(o.requestedMinutes, 18 * 60); // 18:00 desambiguado por los slots de la tarde
  assert.equal(o.slot.startsAt, '2026-06-15T23:15:00.000Z'); // 17:15 es el más cercano
});

// ─── (c) Ordinales ────────────────────────────────────────────────────────────

test('(c) "la primera" selecciona el slot más temprano', () => {
  const r = route('la primera');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T22:45:00.000Z');
});

test('(c) "el último" selecciona el slot más tarde', () => {
  const r = route('el último');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:15:00.000Z');
});

test('(c) "la segunda" selecciona el slot del medio', () => {
  const r = route('la segunda');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:00:00.000Z');
});

// ─── (d) Selección difusa ─────────────────────────────────────────────────────

test('(d) "el más temprano" → slot con menor startsAt', () => {
  const r = route('el más temprano');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T22:45:00.000Z');
});

test('(d) "el más tarde" → slot con mayor startsAt', () => {
  const r = route('el más tarde');
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:15:00.000Z');
});

test('(d) "cualquiera de la tarde" filtra a la tarde (NO cae en no-preferencia)', () => {
  const r = route('cualquiera de la tarde', mixed);
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:00:00.000Z'); // 17:00
});

test('(d) "de la mañana" filtra a la mañana (no se confunde con fecha "mañana")', () => {
  const r = route('de la mañana', mixed);
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T16:00:00.000Z'); // 10:00
});

// ─── (e) Índice numérico como fallback de baja prioridad ──────────────────────

test('(e) "2" se interpreta como índice (no como hora)', () => {
  const r = route('2');
  assert.equal(r.action, 'index');
  assert.equal((r as { choice: number }).choice, 2);
});

test('(e) "uno" sigue funcionando como índice', () => {
  const r = route('uno');
  assert.equal(r.action, 'index');
  assert.equal((r as { choice: number }).choice, 1);
});

test('(e) "5pm" NO se lee como índice 5 (gana el match de hora)', () => {
  const r = route('5pm');
  assert.equal(r.action, 'select'); // no 'index'
});

// ─── (f) AM/PM desambiguado contra los slots reales ───────────────────────────

test('(f) "a las 5" con slots de la TARDE resuelve a 17:00', () => {
  const r = route('a las 5', afternoon);
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:00:00.000Z');
});

test('(f) "a las 5" con slots de la MAÑANA NO fuerza PM (no hay 17:00 → ofrece cercano 5 AM)', () => {
  const r = route('a las 5', morning);
  assert.equal(r.action, 'offer_nearest');
  const o = r as { requestedMinutes: number };
  assert.equal(o.requestedMinutes, 5 * 60); // 05:00, NO 17:00
});

test('(f) "a las 10" con slots de la mañana selecciona 10:00', () => {
  const r = route('a las 10', morning);
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T16:00:00.000Z');
});

// ─── Regla maestra: fecha presente → re-route a date-flow ─────────────────────

test('regla maestra: "mañana a las 5" tiene fecha → date_redirect (no selección)', () => {
  assert.equal(route('mañana a las 5').action, 'date_redirect');
});

test('regla maestra: "el viernes" → date_redirect', () => {
  assert.equal(route('el viernes').action, 'date_redirect');
});

test('regla maestra: "23 de junio" → date_redirect', () => {
  assert.equal(route('23 de junio').action, 'date_redirect');
});

test('regla maestra: "otro día" (cambio de día sin fecha concreta) → date_redirect', () => {
  assert.equal(route('mejor otro día').action, 'date_redirect');
});

test('regla maestra: "5 de la tarde" NO se confunde con fecha (es selección)', () => {
  assert.equal(route('5 de la tarde').action, 'select');
});

// ─── Regresiones ──────────────────────────────────────────────────────────────

test('regresión: "cualquiera" → no_preference', () => {
  assert.equal(route('cualquiera').action, 'no_preference');
});

test('regresión: "el que sea" → no_preference', () => {
  assert.equal(route('el que sea').action, 'no_preference');
});

test('regresión: texto de corrección de servicio NO se malinterpreta en el ruteo', () => {
  // El handler intercepta la corrección de servicio ANTES de routeSlotSelection;
  // el ruteo solo debe devolver 'none' (no select/date_redirect) para este texto.
  assert.equal(route('me equivoque de servicio').action, 'none');
});

test('regresión: input sin sentido → none (lo maneja el retry/clarify del handler)', () => {
  assert.equal(route('asdfgh').action, 'none');
});

// ─── S5-BOT-06: dígito pelado (hora-ofrecida > índice > cercana > clarify) ────
// Precedencia: el dígito desnudo es la HORA que el cliente vio (presentación en
// prosa SIN numerar), no un índice. Solo cae a índice si NO calza ninguna hora
// ofrecida, y a "cercana" si tampoco es índice válido pero es una hora plausible.

// {12:00, 13:00, 15:00} — para el misfire "1" debe ganar 1pm al índice 1.
const trio12 = [slot(1, '12:00'), slot(2, '13:00'), slot(3, '15:00')];
// {12:00, 12:15, 12:30} — el bug original del smoke.
const noon15 = [slot(1, '12:00'), slot(2, '12:15'), slot(3, '12:30')];
// {10:00, 11:00, 12:00} — "3" no calza hora → índice conservador.
const lateMorning = [slot(1, '10:00'), slot(2, '11:00'), slot(3, '12:00')];

test('(06-crítico) "1" ante {12:00,13:00,15:00} → select 13:00 (hora-ofrecida gana al índice)', () => {
  const r = route('1', trio12);
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T19:00:00.000Z'); // 13:00 local
});

test('(06-crítico) "2" ante {16:45,17:00,17:15} → index 2 (NO hay hora 2/14 ofrecida → índice intacto)', () => {
  const r = route('2', afternoon);
  assert.equal(r.action, 'index');
  assert.equal((r as { choice: number }).choice, 2);
});

test('(06) "12" ante {12:00,12:15,12:30} → select 12:00 (bug original del smoke)', () => {
  const r = route('12', noon15);
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T18:00:00.000Z'); // 12:00 local
});

test('(06) "5" ante slots de la tarde → select 17:00 (hoy caía a clarify)', () => {
  const r = route('5', afternoon);
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T23:00:00.000Z'); // 17:00 local
});

test('(06) "3" ante {10:00,11:00,12:00} → index 3 (ambiguo no-calza → índice conservador)', () => {
  const r = route('3', lateMorning);
  assert.equal(r.action, 'index');
  assert.equal((r as { choice: number }).choice, 3);
});

test('(06) "6" ante slots sin las 18:00 → offer_nearest (hora válida no ofrecida → requery)', () => {
  const r = route('6', afternoon);
  assert.equal(r.action, 'offer_nearest');
  const o = r as { requestedMinutes: number; slot: LifestylePendingSlot };
  assert.equal(o.requestedMinutes, 18 * 60); // 18:00 desambiguado por la tarde
  assert.equal(o.slot.startsAt, '2026-06-15T23:15:00.000Z'); // 17:15 es el más cercano
});

test('(06) "0" → índice fuera de rango (el handler lo manda a clarify)', () => {
  const r = route('0');
  assert.equal(r.action, 'index');
  assert.equal((r as { choice: number }).choice, 0);
});

test('(06) "25" → índice fuera de rango (el handler lo manda a clarify)', () => {
  const r = route('25');
  assert.equal(r.action, 'index');
  assert.equal((r as { choice: number }).choice, 25);
});

// ─── S5-BOT-06: no-regresión de la frontera dura ──────────────────────────────

test('(06-noreg) "a las 12" sigue siendo select normal (marcador → matcher, no rama pelada)', () => {
  const r = route('a las 12', noon15);
  assert.equal(r.action, 'select');
  assert.equal((r as { slot: LifestylePendingSlot }).slot.startsAt, '2026-06-15T18:00:00.000Z');
});

test('(06-noreg) "no, a las 6" sigue consumido como corrección por el matcher (offer_nearest)', () => {
  // No es /^\d{1,2}$/ → nunca entra a la rama pelada; lo consume matchNaturalSlot.
  const r = route('no, a las 6');
  assert.equal(r.action, 'offer_nearest');
});

test('(06-noreg) "uno" sigue índice 1 (palabra, no dígito → parseChoice)', () => {
  const r = route('uno', trio12);
  assert.equal(r.action, 'index');
  assert.equal((r as { choice: number }).choice, 1);
});

test('(06-noreg) "5pm" sigue select por el matcher (marcador, no rama pelada)', () => {
  assert.equal(route('5pm').action, 'select');
});
