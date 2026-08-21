// ─── Máquina de estados de las tareas del agente (A3 · S9-AG-02) ─────────────
// El módulo es el ESPEJO de la migración; que los dos mapas no se separen lo
// vigila `agenteTareas.repo.test.ts`. Acá se prueba el comportamiento, con las
// negativas por delante: lo que este primitivo vale es lo que NO deja hacer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADOS,
  TRANSICIONES,
  TERMINALES,
  esTerminal,
  puedeTransicionar,
  exigeActorHumano,
  exigeResultado,
  validarTransicion,
  siguientesPara,
  type EstadoTarea,
} from '../apps/lifestyle/src/lib/agenteTareas.ts';

const STAFF = '11111111-1111-1111-1111-111111111111';

function t(over: Partial<Parameters<typeof validarTransicion>[0]> = {}) {
  return validarTransicion({
    desde: 'propuesta',
    hasta: 'aprobada',
    actorTipo: 'staff',
    actorStaffId: STAFF,
    resultado: null,
    ...over,
  });
}

// ─── El camino feliz, completo ───────────────────────────────────────────────

test('el camino completo propuesta → aprobada → ejecutada → medida es válido', () => {
  assert.deepEqual(t({ desde: 'propuesta', hasta: 'aprobada' }), { ok: true });
  assert.deepEqual(t({ desde: 'aprobada', hasta: 'ejecutada', actorTipo: 'agente', actorStaffId: null }), { ok: true });
  assert.deepEqual(
    t({ desde: 'ejecutada', hasta: 'medida', actorTipo: 'system', actorStaffId: null, resultado: { contactados: 3 } }),
    { ok: true },
  );
});

test('descartar se puede antes de ejecutar, desde los dos estados vivos', () => {
  assert.deepEqual(t({ desde: 'propuesta', hasta: 'descartada' }), { ok: true });
  assert.deepEqual(t({ desde: 'aprobada', hasta: 'descartada' }), { ok: true });
});

// ─── Las negativas: lo que el primitivo existe para impedir ──────────────────

test('NEGATIVA · una tarea no puede saltarse estados (propuesta → ejecutada)', () => {
  const r = t({ desde: 'propuesta', hasta: 'ejecutada', actorTipo: 'agente', actorStaffId: null });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /no es una transición válida/);
});

test('NEGATIVA · propuesta → medida tampoco, aunque traiga resultado', () => {
  const r = t({ desde: 'propuesta', hasta: 'medida', resultado: { contactados: 1 } });
  assert.equal(r.ok, false);
});

test('NEGATIVA · una descartada no reaparece sola: no vuelve a propuesta ni a aprobada', () => {
  for (const hasta of ESTADOS) {
    const r = t({ desde: 'descartada', hasta });
    assert.equal(r.ok, false, `descartada → ${hasta} debería rebotar`);
    assert.match((r as { error: string }).error, /terminal/);
  }
});

test('NEGATIVA · medida es terminal: no se re-mide ni se re-ejecuta', () => {
  for (const hasta of ESTADOS) {
    assert.equal(t({ desde: 'medida', hasta, resultado: { x: 1 } }).ok, false);
  }
});

test('NEGATIVA · aprobar sin actor humano rebota (agente y system incluidos)', () => {
  for (const actorTipo of ['agente', 'system'] as const) {
    const r = t({ hasta: 'aprobada', actorTipo, actorStaffId: null });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /actor humano/);
  }
});

test('NEGATIVA · actorTipo staff SIN staff_id no cuenta como persona', () => {
  const r = t({ hasta: 'aprobada', actorTipo: 'staff', actorStaffId: null });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /actor humano/);
});

test('NEGATIVA · descartar también exige persona: es una decisión, no un barrido', () => {
  const r = t({ desde: 'propuesta', hasta: 'descartada', actorTipo: 'agente', actorStaffId: null });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /actor humano/);
});

test('NEGATIVA · medir sin resultado rebota; con resultado pasa', () => {
  const sin = t({ desde: 'ejecutada', hasta: 'medida', actorTipo: 'system', actorStaffId: null, resultado: null });
  assert.equal(sin.ok, false);
  assert.match((sin as { error: string }).error, /exige resultado/);

  const con = t({ desde: 'ejecutada', hasta: 'medida', actorTipo: 'system', actorStaffId: null, resultado: { r: 0 } });
  assert.deepEqual(con, { ok: true });
});

test('NEGATIVA · un resultado `undefined` no cuenta como resultado', () => {
  const r = t({ desde: 'ejecutada', hasta: 'medida', actorTipo: 'system', actorStaffId: null, resultado: undefined });
  assert.equal(r.ok, false);
});

// ─── Propiedades del mapa ────────────────────────────────────────────────────

test('los terminales se derivan del mapa y son exactamente medida y descartada', () => {
  assert.deepEqual([...TERMINALES].sort(), ['descartada', 'medida']);
  assert.equal(esTerminal('medida'), true);
  assert.equal(esTerminal('propuesta'), false);
});

test('ningún estado se transiciona a sí mismo', () => {
  for (const e of ESTADOS) {
    assert.equal(puedeTransicionar(e, e), false, `${e} → ${e} no debería existir`);
  }
});

test('todo destino del mapa es un estado conocido', () => {
  for (const e of ESTADOS) {
    for (const h of TRANSICIONES[e]) {
      assert.ok(ESTADOS.includes(h), `${e} → ${h}: destino desconocido`);
    }
  }
});

test('todos los estados salvo propuesta son alcanzables desde propuesta', () => {
  const vistos = new Set<EstadoTarea>(['propuesta']);
  const cola: EstadoTarea[] = ['propuesta'];
  while (cola.length) {
    for (const h of TRANSICIONES[cola.shift()!]) {
      if (!vistos.has(h)) { vistos.add(h); cola.push(h); }
    }
  }
  assert.deepEqual([...vistos].sort(), [...ESTADOS].sort());
});

test('exigeActorHumano y exigeResultado marcan exactamente los estados que deben', () => {
  assert.deepEqual(ESTADOS.filter(exigeActorHumano), ['aprobada', 'descartada']);
  assert.deepEqual(ESTADOS.filter(exigeResultado), ['medida']);
});

// ─── Lo que la UI puede ofrecer ──────────────────────────────────────────────

test('siguientesPara no le ofrece al agente lo que la BD le va a rebotar', () => {
  assert.deepEqual(siguientesPara('propuesta', 'agente'), []);
  assert.deepEqual(siguientesPara('propuesta', 'staff'), ['aprobada', 'descartada']);
  assert.deepEqual(siguientesPara('aprobada', 'agente'), ['ejecutada']);
  assert.deepEqual(siguientesPara('ejecutada', 'agente'), ['medida']);
  assert.deepEqual(siguientesPara('medida', 'staff'), []);
});
