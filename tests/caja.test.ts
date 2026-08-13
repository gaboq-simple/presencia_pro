// ─── Tests de movimientos de caja (D4) — validación pura ──────────────────────
// Lo que estos tests fijan es la FRONTERA de la captura: qué combinación de tipo
// y concepto existe (espejo del CHECK pareado de la migración D1), que el monto
// acá es obligatorio —a diferencia del cobro de una cita, donde vacío significa
// "el precio de siempre"— y que el riel jamás sale NULL.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveMovimiento,
  esMovimientoError,
  describeMovimiento,
  etiquetaConcepto,
  notaPlaceholder,
  fmtMonto,
  CONCEPTOS_POR_TIPO,
  NOTA_MAX,
  type MovimientoResuelto,
} from '../apps/lifestyle/src/lib/caja';

function ok(r: ReturnType<typeof resolveMovimiento>): MovimientoResuelto {
  assert.ok(!esMovimientoError(r), `esperaba éxito, salió: ${JSON.stringify(r)}`);
  return r as MovimientoResuelto;
}

function err(r: ReturnType<typeof resolveMovimiento>): string {
  assert.ok(esMovimientoError(r), `esperaba error, salió: ${JSON.stringify(r)}`);
  return (r as { error: string }).error;
}

// ─── El caso normal ───────────────────────────────────────────────────────────

test('entrada de walk-in en efectivo: los cinco campos salen listos para el INSERT', () => {
  const m = ok(resolveMovimiento({ type: 'entrada', concept: 'walkin', amount: '150', method: 'efectivo' }));
  assert.deepEqual(m, { type: 'entrada', concept: 'walkin', amount: 150, method: 'efectivo', note: null });
});

test('salida de insumos con nota: la nota viaja recortada', () => {
  const m = ok(resolveMovimiento({
    type: 'salida', concept: 'insumos', amount: 120, method: 'efectivo', note: '  toallas nuevas  ',
  }));
  assert.equal(m.type, 'salida');
  assert.equal(m.amount, 120);
  assert.equal(m.note, 'toallas nuevas');
});

test('sin riel explícito el default es efectivo — jamás NULL (decisión 2 del plan)', () => {
  const m = ok(resolveMovimiento({ type: 'entrada', concept: 'producto', amount: 80 }));
  assert.equal(m.method, 'efectivo');
});

// ─── El CHECK pareado, del lado de la persona ─────────────────────────────────

test('el concepto tiene que ir con el tipo: "salida por producto" no existe', () => {
  assert.match(err(resolveMovimiento({ type: 'salida', concept: 'producto', amount: 100 })), /concepto/i);
  assert.match(err(resolveMovimiento({ type: 'entrada', concept: 'insumos', amount: 100 })), /concepto/i);
  assert.match(err(resolveMovimiento({ type: 'entrada', concept: 'retiro', amount: 100 })), /concepto/i);
});

test('"otro" vale para los dos lados — es la válvula, no un agujero', () => {
  assert.equal(ok(resolveMovimiento({ type: 'entrada', concept: 'otro', amount: 10 })).concept, 'otro');
  assert.equal(ok(resolveMovimiento({ type: 'salida',  concept: 'otro', amount: 10 })).concept, 'otro');
});

test('la lista de conceptos es la misma que la del CHECK de la migración', () => {
  assert.deepEqual([...CONCEPTOS_POR_TIPO.entrada], ['walkin', 'producto', 'otro']);
  assert.deepEqual([...CONCEPTOS_POR_TIPO.salida],  ['insumos', 'retiro', 'otro']);
});

test('un concepto inventado no pasa aunque el tipo sea correcto', () => {
  assert.ok(esMovimientoError(resolveMovimiento({ type: 'entrada', concept: 'propina', amount: 50 })));
});

test('sin tipo no hay movimiento: el signo del dinero no se adivina', () => {
  assert.match(err(resolveMovimiento({ concept: 'walkin', amount: 100 })), /entró o salió/i);
  assert.ok(esMovimientoError(resolveMovimiento({ type: 'devolucion', concept: 'otro', amount: 1 })));
});

// ─── El monto: acá es obligatorio (la diferencia con el cobro de una cita) ─────

test('monto vacío es ERROR — un movimiento no tiene precio de lista del que caerse', () => {
  assert.match(err(resolveMovimiento({ type: 'entrada', concept: 'walkin', amount: '' })), /monto/i);
  assert.match(err(resolveMovimiento({ type: 'entrada', concept: 'walkin' })), /monto/i);
});

test('cero y negativos no entran: la BD exige amount > 0', () => {
  assert.ok(esMovimientoError(resolveMovimiento({ type: 'entrada', concept: 'walkin', amount: 0 })));
  assert.ok(esMovimientoError(resolveMovimiento({ type: 'salida',  concept: 'retiro', amount: -50 })));
});

test('acepta lo que la gente teclea de verdad ($ y comas) y redondea a centavos', () => {
  assert.equal(ok(resolveMovimiento({ type: 'entrada', concept: 'producto', amount: '$1,250' })).amount, 1250);
  assert.equal(ok(resolveMovimiento({ type: 'entrada', concept: 'producto', amount: '99.999' })).amount, 100);
});

test('riel desconocido se rechaza (no se degrada a efectivo en silencio)', () => {
  assert.ok(esMovimientoError(resolveMovimiento({
    type: 'entrada', concept: 'walkin', amount: 100, method: 'vales',
  })));
});

// ─── La nota ──────────────────────────────────────────────────────────────────

test('nota vacía o de puros espacios queda NULL, no cadena vacía', () => {
  assert.equal(ok(resolveMovimiento({ type: 'entrada', concept: 'otro', amount: 5, note: '   ' })).note, null);
  assert.equal(ok(resolveMovimiento({ type: 'entrada', concept: 'otro', amount: 5 })).note, null);
});

test('la nota es corta por diseño: pasada del tope, se rechaza con su medida', () => {
  const larga = 'x'.repeat(NOTA_MAX + 1);
  assert.match(err(resolveMovimiento({ type: 'entrada', concept: 'otro', amount: 5, note: larga })), /larga/i);
  assert.equal(ok(resolveMovimiento({ type: 'entrada', concept: 'otro', amount: 5, note: 'x'.repeat(NOTA_MAX) })).note!.length, NOTA_MAX);
});

test('el placeholder de la nota invita a COSAS, nunca a nombres de personas', () => {
  for (const c of ['walkin', 'producto', 'insumos', 'retiro', 'otro']) {
    assert.match(notaPlaceholder(c), /^Ej\. /);
  }
  assert.equal(notaPlaceholder('inexistente'), notaPlaceholder('otro'));
});

// ─── Cómo se nombra un movimiento ─────────────────────────────────────────────

test('"walkin" se dice "Sin cita" — la mesa ya usa "Walk-in" para crear una CITA', () => {
  assert.equal(etiquetaConcepto('walkin'), 'Sin cita');
  assert.equal(etiquetaConcepto('retiro'), 'Retiro');
  assert.equal(etiquetaConcepto('desconocido'), 'desconocido'); // degrada, no revienta
});

test('la frase distingue entrada, salida y anulación', () => {
  const base = { concept: 'walkin', amount: 150, method: 'efectivo' };
  assert.equal(describeMovimiento({ ...base, type: 'entrada' }), 'registró una entrada de $150 · sin cita · efectivo');
  assert.equal(describeMovimiento({ ...base, type: 'salida', concept: 'retiro' }), 'registró una salida de $150 · retiro · efectivo');
  // La contraentrada NO repite concepto: el suyo es 'otro' por construcción y no
  // dice nada — el concepto real es el de la fila que anula.
  assert.equal(describeMovimiento({ ...base, type: 'salida', concept: 'otro', anula: true }), 'anuló un movimiento de $150 · efectivo');
});

test('el monto se rinde sin centavos si es entero, y con ellos si no', () => {
  assert.equal(fmtMonto(150), '$150');
  assert.equal(fmtMonto(1250), '$1,250');
  assert.equal(fmtMonto(99.5), '$99.5');
});

// ─── No muta lo que recibe ────────────────────────────────────────────────────

test('no muta el input', () => {
  const input = { type: 'entrada', concept: 'walkin', amount: '150', method: 'tarjeta', note: ' x ' };
  const copia = { ...input };
  resolveMovimiento(input);
  assert.deepEqual(input, copia);
});
