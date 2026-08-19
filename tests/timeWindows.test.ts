// ─── Tests del helper único de ventanas (S7-BUG-01) ──────────────────────────
// Lo que fijan, y es lo que el bug de `revenueTrend` rompía:
//
//   · toda ventana es **semiabierta [inicio, fin)** — un `endMs` de 23:59:59.999
//     pierde el último milisegundo e invita a `.lte()`, que con dos ventanas
//     contiguas cuenta dos veces la fila del borde;
//   · los límites son horas de pared del NEGOCIO, no del proceso. El caso que lo
//     prueba de verdad es **Kiritimati (UTC+14)**, el mismo que D4 midió: del
//     otro lado del meridiano, el inicio del día local cae el día ANTERIOR en
//     UTC, y cualquier cálculo que use `Date.UTC` da un resultado distinto;
//   · el día de la semana de una fecha no depende de ninguna zona horaria.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dayWindow, weekWindow, monthWindow, monthToDateWindow, prevMonthTramoWindow,
  sumarDias, sumarMeses, diasDelMes, diaDeLaSemana, toIso,
} from '../apps/lifestyle/src/lib/timeWindows';

const MX = 'America/Mexico_City';   // UTC-6
const KI = 'Pacific/Kiritimati';    // UTC+14 — el caso de D4

// ─── Aritmética de calendario ────────────────────────────────────────────────

test('sumar días cruza mes y año sin tocar el reloj', () => {
  assert.equal(sumarDias('2026-08-18', 1), '2026-08-19');
  assert.equal(sumarDias('2026-08-31', 1), '2026-09-01');
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(sumarDias('2026-01-01', -1), '2025-12-31');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(sumarDias('2024-03-01', -1), '2024-02-29', 'año bisiesto');
});

test('sumar meses hace clamp al último día del mes destino', () => {
  assert.equal(sumarMeses('2026-08-31', -1), '2026-07-31');
  assert.equal(sumarMeses('2026-07-31', -1), '2026-06-30', '31 de junio no existe');
  assert.equal(sumarMeses('2026-03-31', -1), '2026-02-28');
  assert.equal(sumarMeses('2024-03-31', -1), '2024-02-29');
  assert.equal(sumarMeses('2026-01-15', -1), '2025-12-15', 'wrap de año');
});

test('febrero bisiesto se cuenta bien (incluido el caso del siglo)', () => {
  assert.equal(diasDelMes(2024, 2), 29);
  assert.equal(diasDelMes(2026, 2), 28);
  assert.equal(diasDelMes(2000, 2), 29, 'divisible por 400');
  assert.equal(diasDelMes(1900, 2), 28, 'divisible por 100 pero no por 400');
});

test('el día de la semana no depende de ninguna zona horaria', () => {
  assert.equal(diaDeLaSemana('2026-08-18'), 2, 'martes');
  assert.equal(diaDeLaSemana('2026-08-16'), 0, 'domingo');
  assert.equal(diaDeLaSemana('2026-08-17'), 1, 'lunes');
  assert.equal(diaDeLaSemana('2000-01-01'), 6, 'sábado');
});

// ─── Semiabiertas ────────────────────────────────────────────────────────────

test('★ toda ventana es semiabierta: el fin de una ES el inicio de la siguiente', () => {
  for (const tz of [MX, KI]) {
    assert.equal(dayWindow('2026-08-18', tz).endMs, dayWindow('2026-08-19', tz).startMs, tz);
    assert.equal(weekWindow('2026-08-18', tz).endMs, weekWindow('2026-08-25', tz).startMs, tz);
    assert.equal(monthWindow('2026-08-18', tz).endMs, monthWindow('2026-09-05', tz).startMs, tz);
  }
});

test('ninguna ventana termina en 23:59:59.999', () => {
  const w = dayWindow('2026-08-18', MX);
  assert.equal(new Date(w.endMs).toISOString().endsWith('999Z'), false);
});

// ─── ★ El caso Kiritimati (UTC+14) — el que D4 midió ─────────────────────────

test('★ Kiritimati: el día local EMPIEZA el día anterior en UTC', () => {
  const w = dayWindow('2026-08-18', KI);
  // 2026-08-18 00:00 en UTC+14 es 2026-08-17 10:00Z.
  assert.equal(new Date(w.startMs).toISOString(), '2026-08-17T10:00:00.000Z');
  assert.equal(new Date(w.endMs).toISOString(), '2026-08-18T10:00:00.000Z');
});

test('★ el mismo día calendario da ventanas DISTINTAS según la tz del negocio', () => {
  const mx = dayWindow('2026-08-18', MX);
  const ki = dayWindow('2026-08-18', KI);
  assert.notEqual(mx.startMs, ki.startMs);
  // 20 horas de diferencia entre UTC-6 y UTC+14 — el ancho del error que este
  // helper existe para evitar.
  assert.equal((mx.startMs - ki.startMs) / 3_600_000, 20);
});

test('★ el mes de Kiritimati NO empieza el día 1 a las 00:00Z', () => {
  const w = monthWindow('2026-08-18', KI);
  assert.equal(new Date(w.startMs).toISOString(), '2026-07-31T10:00:00.000Z');
  // Ese es exactamente el error de `revenueTrend`: con `Date.UTC` el mes
  // empezaría el 2026-08-01T00:00Z y se comería 14 horas del mes siguiente.
  assert.notEqual(new Date(w.startMs).toISOString(), '2026-08-01T00:00:00.000Z');
});

// ─── México: el caso que el bug rompía en producción ─────────────────────────

test('★ el mes de México empieza a las 06:00Z del día 1, no a las 00:00Z', () => {
  const w = monthWindow('2026-08-18', MX);
  assert.equal(new Date(w.startMs).toISOString(), '2026-08-01T06:00:00.000Z');
  // Las seis horas entre 00:00Z y 06:00Z del día 1 son la NOCHE DEL 31 DE JULIO
  // en el local. `Date.UTC` las metía en agosto: son los $520 medidos en dv3-6.
});

test('la semana es lunes→domingo y contiene a su fecha', () => {
  const w = weekWindow('2026-08-18', MX);  // martes
  assert.equal(new Date(w.startMs).toISOString(), '2026-08-17T06:00:00.000Z', 'lunes 17');
  assert.equal(new Date(w.endMs).toISOString(),   '2026-08-24T06:00:00.000Z', 'lunes 24');
});

test('el domingo pertenece a la semana que EMPEZÓ el lunes anterior', () => {
  const dom = weekWindow('2026-08-16', MX);   // domingo
  const mar = weekWindow('2026-08-11', MX);   // martes de esa misma semana
  assert.equal(dom.startMs, mar.startMs);
  assert.equal(new Date(dom.startMs).toISOString(), '2026-08-10T06:00:00.000Z');
});

// ─── Tramos ──────────────────────────────────────────────────────────────────

test('el tramo del mes va del día 1 a AHORA', () => {
  const ahora = Date.parse('2026-08-18T22:30:00Z');
  const w = monthToDateWindow('2026-08-18', MX, ahora);
  assert.equal(new Date(w.startMs).toISOString(), '2026-08-01T06:00:00.000Z');
  assert.equal(w.endMs, ahora);
});

test('el tramo del mes anterior corta al FINAL del mismo día de mes', () => {
  const w = prevMonthTramoWindow('2026-08-18', MX);
  assert.equal(new Date(w.startMs).toISOString(), '2026-07-01T06:00:00.000Z');
  // Semiabierta: hasta el inicio del 19 de julio = todo el 18 incluido.
  assert.equal(new Date(w.endMs).toISOString(), '2026-07-19T06:00:00.000Z');
  assert.equal(w.clamped, false);
});

test('★ borde de mes: el 31 contra un mes de 30 días hace clamp y lo avisa', () => {
  const w = prevMonthTramoWindow('2026-07-31', MX);   // junio tiene 30
  assert.equal(new Date(w.startMs).toISOString(), '2026-06-01T06:00:00.000Z');
  assert.equal(new Date(w.endMs).toISOString(),   '2026-07-01T06:00:00.000Z', 'junio completo');
  assert.equal(w.clamped, true);
});

test('México es UTC-6 todo el año (sin horario de verano desde 2022)', () => {
  // Se fija porque la primera versión de este archivo asumió UTC-5 en junio y el
  // helper la corrigió. Si un día México reinstaura el DST, este test avisa antes
  // de que un mes de verano empiece con una hora corrida.
  for (const fecha of ['2026-01-15', '2026-06-15', '2026-08-18', '2026-12-15']) {
    assert.equal(
      new Date(dayWindow(fecha, MX).startMs).toISOString().slice(11, 16), '06:00',
      `${fecha} debería empezar a las 06:00Z`,
    );
  }
});

test('toIso devuelve exactamente los strings que comen .gte() y .lt()', () => {
  const { start, end } = toIso(dayWindow('2026-08-18', MX));
  assert.equal(start, '2026-08-18T06:00:00.000Z');
  assert.equal(end,   '2026-08-19T06:00:00.000Z');
});
