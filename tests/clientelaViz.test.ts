// ─── Tests de la composición 100% y del archivo por días (dv3-5'') ───────────
// Dos módulos puros que sostienen la mitad de diseño del Paso 5.
//
// `sharePcts` — lo que fija y no se puede mover sin romper la barra:
//   · la suma es EXACTAMENTE 100 (redondear cinco porcentajes por separado deja
//     un hueco que en una barra con overflow:hidden se ve como un mordisco);
//   · un valor > 0 nunca se redondea a 0 (un grupo de 1 sobre 125 desaparecería
//     justo cuando aparece), y lo que se le regala sale de los grandes;
//   · un cero es cero (un grupo vacío no ocupa lugar).
//
// `agruparPorDia` — el día es el del NEGOCIO, el orden de entrada se conserva, y
// una fecha inválida no se traga la fila.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sharePcts, MIN_SHARE_PCT, pctWidth } from '../apps/lifestyle/src/lib/viz';
import { agruparPorDia, horaLocal } from '../apps/lifestyle/src/lib/actividadDias';

const TZ = 'America/Mexico_City';
const suma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

// ─── sharePcts ────────────────────────────────────────────────────────────────

test('los porcentajes suman exactamente 100', () => {
  // Los cinco grupos de la maqueta: 48 · 28 · 5 · 26 · 18 = 125.
  assert.equal(suma(sharePcts([48, 28, 5, 26, 18])), 100);
  // Un caso que redondeado por separado NO suma 100 (tres tercios).
  assert.equal(suma(sharePcts([1, 1, 1])), 100);
  assert.equal(suma(sharePcts([7, 7, 7, 7, 7, 7, 7])), 100);
});

test('la proporción es contra el TOTAL, no contra el máximo', () => {
  const p = sharePcts([50, 25, 25]);
  assert.deepEqual(p, [50, 25, 25]);
  // El contraste con pctWidth, que es la confusión que este módulo vino a evitar:
  // mide contra el máximo y por eso el mayor siempre sale 100.
  assert.equal(pctWidth(50, 50), 100);
});

test('un grupo de 1 sobre 125 no desaparece', () => {
  const p = sharePcts([124, 1]);
  assert.ok(p[1]! >= MIN_SHARE_PCT, `el chico quedó en ${p[1]}`);
  assert.equal(suma(p), 100);
  // Y lo que se le regaló salió del grande, no del aire.
  assert.ok(p[0]! < 99.2);
});

test('el cero es cero — un grupo vacío no ocupa lugar', () => {
  const p = sharePcts([10, 0, 5, 0]);
  assert.equal(p[1], 0);
  assert.equal(p[3], 0);
  assert.equal(suma(p), 100);
});

test('sin nada que repartir, todo en cero (sin dividir por cero)', () => {
  assert.deepEqual(sharePcts([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(sharePcts([]), []);
});

test('los negativos y los NaN se tratan como cero, no revientan', () => {
  const p = sharePcts([10, -5, Number.NaN, 10]);
  assert.equal(p[1], 0);
  assert.equal(p[2], 0);
  assert.equal(suma(p), 100);
});

test('el orden relativo se conserva aunque haya piso', () => {
  const p = sharePcts([200, 100, 1, 1]);
  assert.ok(p[0]! > p[1]!);
  assert.ok(p[1]! > p[2]!);
  assert.equal(suma(p), 100);
});

// ─── agruparPorDia ────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD HH:MM' local (UTC-6) → ISO UTC. */
const at = (fecha: string, hhmm: string) => {
  const [y, m, d] = fecha.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, h! + 6, mi!)).toISOString();
};

test('agrupa por día local y etiqueta Hoy / Ayer / la fecha', () => {
  const evs = [
    { at: at('2026-08-18', '17:22') },
    { at: at('2026-08-18', '16:34') },
    { at: at('2026-08-17', '20:02') },
    { at: at('2026-08-15', '18:47') },
  ];
  const bloques = agruparPorDia(evs, TZ, '2026-08-18');
  assert.equal(bloques.length, 3);
  assert.equal(bloques[0]!.etiqueta, 'Hoy · martes 18');
  assert.equal(bloques[0]!.eventos.length, 2);
  assert.equal(bloques[1]!.etiqueta, 'Ayer · lunes 17');
  assert.equal(bloques[2]!.etiqueta, 'sábado 15 de agosto');
});

test('el día es el del NEGOCIO: las 23:30 locales no se van al día siguiente', () => {
  // 23:30 en México (UTC-6) es 05:30Z del día siguiente. Con la tz del negocio,
  // el evento pertenece al 18; leído en UTC se iría al 19.
  const bloques = agruparPorDia([{ at: at('2026-08-18', '23:30') }], TZ, '2026-08-18');
  assert.equal(bloques[0]!.fecha, '2026-08-18');
  assert.equal(bloques[0]!.etiqueta, 'Hoy · martes 18');
});

test('conserva el orden de entrada — el feed ya viene ordenado', () => {
  const evs = [
    { at: at('2026-08-18', '10:00'), id: 'a' },
    { at: at('2026-08-18', '17:00'), id: 'b' },
    { at: at('2026-08-17', '09:00'), id: 'c' },
  ];
  const bloques = agruparPorDia(evs, TZ, '2026-08-18');
  assert.deepEqual(bloques[0]!.eventos.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(bloques[1]!.eventos.map((e) => e.id), ['c']);
});

test('una fecha inválida no se traga la fila', () => {
  const bloques = agruparPorDia([{ at: 'no-es-fecha' }], TZ, '2026-08-18');
  assert.equal(bloques.length, 1);
  assert.equal(bloques[0]!.etiqueta, 'Sin fecha');
  assert.equal(bloques[0]!.eventos.length, 1);
});

test('sin eventos no hay bloques', () => {
  assert.deepEqual(agruparPorDia([], TZ, '2026-08-18'), []);
});

test('la hora de la fila es hora de pared del negocio', () => {
  assert.equal(horaLocal(at('2026-08-18', '17:22'), TZ), '17:22');
  assert.equal(horaLocal(at('2026-08-18', '09:05'), TZ), '09:05');
  assert.equal(horaLocal('no-es-fecha', TZ), '');
});
