// ─── Tests del riel del día (dv3-4') — matemática pura ────────────────────────
// Lo que estos tests fijan y no se puede mover sin cambiar el significado:
//   · un hueco es un tramo en el que NADIE atiende (barrido por máximo fin), no
//     "un barbero desocupado";
//   · los nombres del hueco son los barberos EN TURNO en ese tramo, con su
//     descanso descontado;
//   · la línea "ahora" solo existe si el día que se mira ES hoy, y nunca se
//     pierde por el recorte de la ventana;
//   · la ventana se ancla en "ahora" — un tope contado desde el inicio del día
//     le muestra al dueño, a las 7 de la tarde, ocho citas que ya pasaron;
//   · plegar no es esconder: `todas` conserva el día completo.
//
// TZ del negocio = America/Mexico_City (UTC-6 en agosto) en todos los casos, para
// que las horas de pared del test no dependan de la tz del proceso.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDiaRail,
  estadoDeStatus,
  listarLibres,
  HUECO_MIN_MINUTOS,
  TOPE_CITAS,
  type RailAppt,
  type RailTurno,
  type RailRow,
} from '../apps/lifestyle/src/lib/diaRail';
import { staffColorIndex } from '../apps/lifestyle/src/lib/staffColors';

const TZ = 'America/Mexico_City';

const STAFF = [
  { id: 'car', name: 'Carlos' },
  { id: 'and', name: 'Andrés' },
  { id: 'bet', name: 'Beto' },
];
const COLOR = staffColorIndex(STAFF);

/** 'HH:MM' local (UTC-6) → ISO UTC del 2026-08-18. */
function iso(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 7, 18, h! + 6, m!)).toISOString();
}
function ms(hhmm: string): number {
  return Date.parse(iso(hhmm));
}

function cita(
  id: string, ini: string, fin: string,
  staffId = 'car', status = 'confirmed',
): RailAppt {
  const s = STAFF.find((x) => x.id === staffId)!;
  return {
    id, startsAt: iso(ini), endsAt: iso(fin), status,
    staffId, staffName: s.name, serviceName: 'Corte', clientName: `Cliente ${id}`,
  };
}

const TURNO_COMPLETO: RailTurno[] = STAFF.map((s) => ({
  staffId: s.id, staffName: s.name,
  startTime: '10:00', endTime: '20:00', breakStart: null, breakEnd: null,
}));

function correr(citas: RailAppt[], opts?: {
  turnos?: RailTurno[]; now?: string; esHoy?: boolean;
}) {
  return computeDiaRail({
    citas,
    turnos:        opts?.turnos ?? TURNO_COMPLETO,
    colorPorStaff: COLOR,
    timezone:      TZ,
    nowMs:         ms(opts?.now ?? '12:00'),
    esHoy:         opts?.esHoy ?? true,
  });
}

const citas = (rows: readonly RailRow[]) => rows.filter((r) => r.kind === 'cita');
const huecos = (rows: readonly RailRow[]) => rows.filter((r) => r.kind === 'hueco');

// ─── Color de identidad ───────────────────────────────────────────────────────

test('el color sale del orden alfabético, no del orden de llegada', () => {
  // Andrés < Beto < Carlos en español, aunque STAFF venga en otro orden.
  assert.equal(COLOR.get('and'), 0);
  assert.equal(COLOR.get('bet'), 1);
  assert.equal(COLOR.get('car'), 2);
});

// ─── Horas de pared ───────────────────────────────────────────────────────────

test('la hora de la fila es hora de pared del negocio, no UTC', () => {
  const r = correr([cita('a', '19:00', '19:30')], { now: '10:00' });
  const [c] = citas(r.ventana);
  assert.equal(c!.kind === 'cita' && c!.hora, '19:00');
});

// ─── Huecos ───────────────────────────────────────────────────────────────────

test('un hueco es un tramo en que NADIE atiende (no un barbero desocupado)', () => {
  // Carlos 10–11 y Andrés 10:30–12: aunque Carlos se desocupa a las 11, el
  // negocio sigue atendiendo hasta las 12. No hay hueco antes de las 12.
  const r = correr([
    cita('a', '10:00', '11:00', 'car'),
    cita('b', '10:30', '12:00', 'and'),
    cita('c', '13:00', '13:30', 'bet'),
  ], { now: '10:15' });
  const hs = huecos(r.todas);
  assert.equal(hs.length, 1);
  assert.equal(hs[0]!.kind === 'hueco' && hs[0]!.minutos, 60); // 12:00 → 13:00
});

test('un tramo menor al mínimo no se dibuja como hueco', () => {
  const corto = HUECO_MIN_MINUTOS - 5;
  const r = correr([
    cita('a', '10:00', '11:00'),
    cita('b', `11:${String(corto).padStart(2, '0')}`, '12:00'),
  ], { now: '10:15' });
  assert.equal(huecos(r.todas).length, 0);
});

test('el hueco nombra a los barberos EN TURNO, con el descanso descontado', () => {
  const turnos: RailTurno[] = [
    { staffId: 'car', staffName: 'Carlos', startTime: '10:00', endTime: '20:00', breakStart: null, breakEnd: null },
    { staffId: 'and', staffName: 'Andrés', startTime: '10:00', endTime: '20:00', breakStart: '13:00', breakEnd: '14:00' },
    { staffId: 'bet', staffName: 'Beto',   startTime: '10:00', endTime: '12:00', breakStart: null, breakEnd: null },
  ];
  // Hueco 12:00 → 14:00, medio a las 13:00: Beto ya salió, Andrés está comiendo.
  const r = correr([
    cita('a', '11:00', '12:00'),
    cita('b', '14:00', '15:00'),
  ], { turnos, now: '11:30' });
  const h = huecos(r.todas)[0];
  assert.equal(h!.kind === 'hueco' && h!.libres, 'Carlos');
});

test('con más de tres barberos libres el hueco dice el conteo, no la lista', () => {
  assert.equal(listarLibres(['Ana']), 'Ana');
  assert.equal(listarLibres(['Ana', 'Beto']), 'Ana y Beto');
  assert.equal(listarLibres(['Ana', 'Beto', 'Cira']), 'Ana, Beto y Cira');
  assert.equal(listarLibres(['Ana', 'Beto', 'Cira', 'Dan']), '4 barberos');
  assert.equal(listarLibres([]), '');
});

// ─── La línea "ahora" ─────────────────────────────────────────────────────────

test('"ahora" se mete entre la última pasada y la primera futura', () => {
  const r = correr([
    cita('a', '10:00', '11:00'),
    cita('b', '11:00', '12:00'),
    cita('c', '14:00', '15:00'),
    cita('d', '15:00', '16:00'),
  ], { now: '13:00' });
  const i = r.todas.findIndex((x) => x.kind === 'ahora');
  assert.ok(i > 0);
  // Todo lo que está antes de la línea es pasado; todo lo de después, futuro.
  for (const row of r.todas.slice(0, i)) if (row.kind === 'cita') assert.equal(row.pasado, true);
  for (const row of r.todas.slice(i)) if (row.kind === 'cita') assert.equal(row.pasado, false);
});

test('otro día NO tiene línea "ahora"', () => {
  const r = correr([cita('a', '10:00', '11:00')], { esHoy: false, now: '12:00' });
  assert.equal(r.todas.some((x) => x.kind === 'ahora'), false);
});

test('día vacío de hoy: solo la línea "ahora"', () => {
  const r = correr([], { now: '12:34' });
  assert.equal(r.ventana.length, 1);
  assert.equal(r.ventana[0]!.kind, 'ahora');
  assert.equal(r.ventana[0]!.kind === 'ahora' && r.ventana[0]!.hora, '12:34');
  assert.equal(r.totalCitas, 0);
  assert.equal(r.ocultas, 0);
});

test('día vacío de otro día: riel vacío, sin línea', () => {
  const r = correr([], { esHoy: false });
  assert.deepEqual(r.ventana, []);
});

// ─── La ventana ───────────────────────────────────────────────────────────────

const DIA_LARGO = Array.from({ length: 20 }, (_, i) => {
  const h = 8 + i;                              // 08:00 … 27:00 — se usa el índice, no el reloj
  return cita(`c${String(i).padStart(2, '0')}`, `${String(h % 24).padStart(2, '0')}:00`, `${String(h % 24).padStart(2, '0')}:45`);
}).slice(0, 12);                                 // 08:00 … 19:00, 12 citas

test('la ventana se ancla en "ahora": 2 de contexto pasado + lo que viene', () => {
  // 12 citas de 08:00 a 19:00; ahora 15:30 → 8 pasadas (08–15), 4 futuras.
  // El tope (8) es TECHO, no cuota: con solo 4 por delante son 2 + 4 = 6 filas,
  // y NO se rellena hacia atrás con pasado para llegar a ocho.
  const r = correr(DIA_LARGO, { now: '15:30' });
  const v = citas(r.ventana);
  assert.equal(v.length, 6);
  const pasadas = v.filter((x) => x.kind === 'cita' && x.pasado).length;
  assert.equal(pasadas, 2, 'exactamente 2 de contexto pasado');
  assert.equal(v[0]!.kind === 'cita' && v[0]!.hora, '14:00');
  assert.equal(v[v.length - 1]!.kind === 'cita' && v[v.length - 1]!.hora, '19:00');
  assert.equal(r.ocultas, 6);
  assert.equal(r.totalCitas, 12);
});

test('con muchas por delante, la ventana llega al tope y no lo pasa', () => {
  // ahora 09:30 → 2 pasadas (08, 09) y 10 futuras: 2 + 6 = 8, el techo.
  const r = correr(DIA_LARGO, { now: '09:30' });
  const v = citas(r.ventana);
  assert.equal(v.length, TOPE_CITAS);
  assert.equal(v.filter((x) => x.kind === 'cita' && x.pasado).length, 2);
  assert.equal(r.ocultas, 4);
});

test('cuando el día ya terminó, la ventana son las últimas y la línea queda al final', () => {
  const r = correr(DIA_LARGO, { now: '23:30' });
  const v = citas(r.ventana);
  assert.equal(v.length, TOPE_CITAS);
  assert.ok(v.every((x) => x.kind === 'cita' && x.pasado));
  assert.equal(r.ventana[r.ventana.length - 1]!.kind, 'ahora');
});

test('antes de abrir, la ventana son las primeras y la línea queda al principio', () => {
  const r = correr(DIA_LARGO, { now: '06:00' });
  const v = citas(r.ventana);
  assert.equal(v.length, TOPE_CITAS);
  assert.ok(v.every((x) => x.kind === 'cita' && !x.pasado));
  assert.equal(r.ventana[0]!.kind, 'ahora');
});

test('otro día: la ventana arranca en el inicio del día (no hay presente al que anclar)', () => {
  const r = correr(DIA_LARGO, { esHoy: false, now: '15:30' });
  const v = citas(r.ventana);
  assert.equal(v[0]!.kind === 'cita' && v[0]!.hora, '08:00');
});

test('plegar no es esconder: `todas` conserva el día completo', () => {
  const r = correr(DIA_LARGO, { now: '15:30' });
  assert.equal(citas(r.todas).length, 12);
});

test('la ventana no arranca ni termina en un hueco (le faltaría un lado)', () => {
  const r = correr([
    cita('a', '10:00', '10:30'),
    cita('b', '13:00', '13:30'),   // hueco de 150 min entre a y b
    cita('c', '18:00', '18:30'),   // hueco de 270 min entre b y c
  ], { now: '12:00' });
  assert.notEqual(r.ventana[0]!.kind, 'hueco');
  assert.notEqual(r.ventana[r.ventana.length - 1]!.kind, 'hueco');
});

// ─── Conteos y leyenda ────────────────────────────────────────────────────────

test('completadas y "por atender" cuentan lo que dicen', () => {
  const r = correr([
    cita('a', '10:00', '10:30', 'car', 'completed'),
    cita('b', '10:30', '11:00', 'and', 'completed'),
    cita('c', '11:00', '11:30', 'bet', 'no_show'),
    cita('d', '11:30', '12:00', 'car', 'cancelled'),
    cita('e', '14:00', '14:30', 'and', 'confirmed'),
    cita('f', '15:00', '15:30', 'bet', 'pending'),
  ], { now: '13:00' });
  assert.equal(r.completadas, 2);
  assert.equal(r.porAtender, 2);   // no_show y cancelled YA se resolvieron
});

test('la leyenda solo trae barberos con cita, en el orden fijo del color', () => {
  const r = correr([
    cita('a', '10:00', '10:30', 'car'),
    cita('b', '11:00', '11:30', 'bet'),
  ], { now: '10:15' });
  assert.deepEqual(r.leyenda.map((l) => l.name), ['Beto', 'Carlos']);  // 1 < 2
});

test('el status desconocido no revienta: cae a pendiente', () => {
  assert.equal(estadoDeStatus('completed'), 'completada');
  assert.equal(estadoDeStatus('no_show'), 'no_vino');
  assert.equal(estadoDeStatus('marciano'), 'pendiente');
});
