// ─── Repo-check: cero voseo en el copy ────────────────────────────────────────
// La regla existe desde siempre (`prompt.ts`: "Español mexicano neutro SIEMPRE") y
// el plan de la capa de dinero la repite entre sus prohibiciones. Hasta hoy se
// verificaba a ojo, y a ojo se escapaba: al barrer la app aparecieron 16 usos en
// 12 archivos, todos escritos DESPUÉS de que la regla existiera. Un grep que
// nadie corre no es una regla, es una intención.
//
// Este test la vuelve mecánica: si alguien escribe "Intentá de nuevo" en un
// toast, la suite se pone roja con el archivo y la línea.
//
// FRONTERA — lo que este test NO puede decidir solo, y por eso lleva permisos:
//   · las formas en -í del voseo (elegí, seguí, salí) son IDÉNTICAS al pretérito
//     de primera persona en español neutro: "no te seguí bien" es correcto y el
//     bot lo dice. Se permiten por línea exacta, no por archivo, para que un
//     "elegí un hueco" nuevo siga cayendo.
//   · la propia regla del prompt CITA el voseo como contraejemplo ("podés",
//     "tenés" → "puedes", "tienes"). Cualquier línea que hable de voseo queda
//     exenta: es la que enseña a no usarlo.
//   · los tokens que el bot RECONOCE de lo que teclea el cliente ("dale", "va")
//     no son copy: son entrada. No están en la lista.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// `onboarding/` entra porque el guion del corte (D5) es copy de producto: se lee
// EN VOZ ALTA al cliente el primer día y comparte vocabulario con la UI. Se
// escribió con voseo en el primer intento — justo el doc del español neutro.
const RAICES = ['apps/lifestyle/src', 'packages/engine/src', 'onboarding'];
const EXT = ['.ts', '.tsx', '.md'];
const IGNORAR = new Set(['node_modules', '.next', 'dist', 'build']);

/** Formas de voseo que no se confunden con nada del español neutro. */
const VOSEO = [
  // presente
  'tenés', 'podés', 'sabés', 'querés', 'hacés', 'decís', 'vivís', 'sos',
  // imperativo en -á / -é (el pretérito de esos verbos termina en -é / -í, no acá)
  'probá', 'agregá', 'usá', 'ajustá', 'intentá', 'seleccioná', 'creá', 'tocá',
  'mirá', 'dejá', 'esperá', 'buscá', 'guardá', 'cambiá', 'mandá', 'revisá',
  'contá', 'llamá', 'anotá', 'avisá', 'marcá', 'apretá', 'entrá', 'activá',
  'desactivá', 'configurá', 'arrastrá', 'copiá', 'pegá', 'preguntá', 'verificá',
  'confirmá', 'poné', 'andá', 'volvé', 'corré', 'leé', 'respondé', 'aprendé',
  'acordate', 'acordáte', 'fijate', 'fijáte', 'soltá', 'deslizá', 'clickeá',
  'bajá', 'cerrá', 'tomá', 'sacá', 'fijá', 'quedate', 'quedáte',
  // imperativo en -í (AMBIGUO con el pretérito: ver las excepciones de abajo)
  'elegí', 'seguí', 'escribí', 'abrí', 'salí', 'subí', 'pedí', 'vení', 'compartí',
];

const PATRON = new RegExp(`(^|[^\\p{L}])(${VOSEO.join('|')})([^\\p{L}]|$)`, 'iu');

/**
 * Líneas exentas. Dos motivos y ninguno más: la línea ENSEÑA sobre voseo (y por
 * lo tanto lo cita), o usa una forma en -í que en realidad es pretérito.
 */
function exenta(linea: string): boolean {
  const l = linea.toLowerCase();
  return l.includes('voseo') || l.includes('seguí bien');
}

function archivos(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (IGNORAR.has(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, acc);
    else if (EXT.some((e) => nombre.endsWith(e))) acc.push(ruta);
  }
  return acc;
}

test('cero voseo en el copy de la app y del bot (español mexicano neutro)', () => {
  const hallazgos: string[] = [];

  for (const raiz of RAICES) {
    for (const ruta of archivos(raiz)) {
      const lineas = readFileSync(ruta, 'utf8').split('\n');
      lineas.forEach((linea, i) => {
        if (exenta(linea)) return;
        const m = PATRON.exec(linea);
        if (m) hallazgos.push(`${ruta}:${i + 1} → "${m[2]}"  ${linea.trim().slice(0, 90)}`);
      });
    }
  }

  assert.deepEqual(
    hallazgos,
    [],
    `Voseo en el copy (${hallazgos.length}). Español mexicano neutro: "tenés"→"tienes", ` +
      `"elegí"→"elige", "Intentá"→"Intenta".\n${hallazgos.join('\n')}`,
  );
});

// Control negativo: el test tiene que poder fallar. Si el patrón se rompiera (un
// escape mal puesto, un flag de más), el test de arriba pasaría siempre en verde
// y nadie se enteraría — que es exactamente el estado del que venimos.
test('control negativo: el patrón SÍ detecta voseo y respeta las excepciones', () => {
  assert.ok(PATRON.test('setError("No se pudo guardar. Intentá de nuevo.")'), 'debe detectar "Intentá"');
  assert.ok(PATRON.test('lo tenés arriba'), 'debe detectar "tenés"');
  assert.ok(PATRON.test('· elegí un hueco'), 'debe detectar "elegí"');
  assert.ok(!PATRON.test('Intenta de nuevo'), 'no debe marcar el neutro');
  assert.ok(!PATRON.test('llegará, enviará, después, inglés, estrés'), 'no debe marcar acentos legítimos');
  assert.ok(!PATRON.test('no entendí, capté, pregunté'), 'no debe marcar pretéritos de primera persona');
  assert.ok(exenta('- Español mexicano neutro SIEMPRE: nunca voseo ("podés", "tenés")'), 'la regla se exime');
  assert.ok(exenta('Disculpa, no te seguí bien.'), 'el pretérito legítimo se exime');
  assert.ok(!exenta('Probá con otro filtro'), 'una línea cualquiera NO se exime');
  assert.ok(PATRON.test('Al cerrar, contá dos cosas'), 'debe detectar voseo en el guion (.md)');
});
