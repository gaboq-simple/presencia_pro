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
// ── El presente: por qué acá NO hay lista de palabras prohibidas ─────────────
// La primera versión de este test era una LISTA DE NEGACIÓN de ~60 formas, y una
// lista de negación tiene agujeros por construcción: `trabajás` no estaba, así
// que dos usos en copy visible (el dueño y el barbero) convivieron con la suite
// en verde. Peor: la lista tenía formas en -és y en -ís y NI UNA en -ás, o sea
// que le faltaba entero el presente de los verbos en -ar.
//
// El presente del voseo se forma con tres terminaciones y nada más: -ás (mirar →
// mirás), -és (tener → tenés) y -ís (vivir → vivís). Eso SÍ es una regla, así que
// se invierte el planteo: **toda palabra terminada en -ás/-és/-ís es sospechosa**
// y lo que se enumera son las LEGÍTIMAS. Agregar un verbo no requiere tocar el
// test; agregar una palabra española nueva con esa terminación, sí — y eso es una
// decisión consciente, que es justo lo que la lista de negación no pedía.
//
// Dos exenciones dentro de la regla, ambas con su costo declarado:
//   · **El futuro de segunda persona** termina SIEMPRE en -rás (infinitivo + s):
//     "podrás", "encontrarás", "recibirás". Se exime la terminación entera.
//     ⚠️ Precio: el voseo de un verbo en -ar cuya RAÍZ termina en r también cae
//     ahí (mirás, entrás, esperás), porque el sufijo solo no los distingue de
//     "irás"/"vivirás". Se recuperan a mano en VOSEO_EN_RAS — cerrar el agujero
//     conocido en vez de fingir que no existe.
//   · **Los nombres propios y las palabras comunes** con esa terminación (más,
//     después, país, Andrés) viven en LEGITIMAS.
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

/**
 * Imperativos del voseo. Acá SÍ hay lista: el imperativo se forma quitando la -r
 * al infinitivo y acentuando la última vocal, y el resultado choca con demasiadas
 * palabras neutras como para derivarlo por sufijo. El presente, en cambio, va por
 * regla (ver PRESENTE más abajo).
 */
const VOSEO = [
  // `sos` es irregular y no termina en -ás/-és/-ís: no lo cubre la regla.
  'sos',
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

// ─── PRESENTE: la regla, no la lista ─────────────────────────────────────────

/** Toda palabra que termine así es sospechosa de ser presente de voseo. */
const PRESENTE = /(^|[^\p{L}])(\p{L}*[áéí]s)(?![\p{L}])/giu;

/** Palabras españolas legítimas con esa terminación. Nombres propios incluidos. */
const LEGITIMAS = new Set([
  // adverbios, preposiciones y cuantificadores
  'más', 'además', 'demás', 'jamás', 'quizás', 'atrás', 'detrás', 'después', 'través',
  // sustantivos y adjetivos
  'país', 'compás', 'interés', 'estrés', 'revés', 'arnés', 'exprés', 'cortés',
  'inglés', 'francés', 'portugués', 'japonés', 'holandés', 'irlandés', 'burgués',
  // el único presente de indicativo neutro con esta forma: tú, de estar
  'estás',
  // nombres propios
  'andrés', 'tomás', 'inés', 'moisés',
]);

/**
 * Voseo que la exención del futuro se traga: verbos en -ar cuya raíz termina en r,
 * cuyo presente de voseo termina igual que un futuro (mirás ~ irás). Cerrar el
 * agujero a mano es más honesto que ampliar la regla y llenarla de falsos
 * positivos sobre "encontrarás".
 */
const VOSEO_EN_RAS = new Set([
  'mirás', 'entrás', 'esperás', 'comprás', 'cerrás', 'mejorás', 'borrás',
  'ahorrás', 'llorás', 'apurás', 'separás', 'preparás',
]);

/** Futuro de segunda persona: infinitivo + s, o sea SIEMPRE -rás. */
function esFuturo(palabra: string): boolean {
  return palabra.endsWith('rás') && !VOSEO_EN_RAS.has(palabra);
}

/** Devuelve la primera palabra de la línea que sea presente de voseo, o null. */
function presenteDeVoseo(linea: string): string | null {
  PRESENTE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRESENTE.exec(linea)) !== null) {
    const palabra = (m[2] ?? '').toLowerCase();
    if (palabra.length < 3) continue;          // "más" ya está en LEGITIMAS; esto corta ruido
    if (LEGITIMAS.has(palabra)) continue;
    if (esFuturo(palabra)) continue;
    return palabra;
  }
  return null;
}

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
        if (m) { hallazgos.push(`${ruta}:${i + 1} → "${m[2]}"  ${linea.trim().slice(0, 90)}`); return; }
        const p = presenteDeVoseo(linea);
        if (p) hallazgos.push(`${ruta}:${i + 1} → "${p}"  ${linea.trim().slice(0, 90)}`);
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
  // `tenés` ya NO lo cubre PATRON: el presente pasó a ser regla (ver el test de
  // abajo). PATRON se queda con los imperativos y con `sos`.
  assert.ok(PATRON.test('vos sos el encargado'), 'debe detectar "sos" (irregular)');
  assert.ok(!PATRON.test('lo tenés arriba'), 'el presente ya no vive en la lista');
  assert.ok(PATRON.test('· elegí un hueco'), 'debe detectar "elegí"');
  assert.ok(!PATRON.test('Intenta de nuevo'), 'no debe marcar el neutro');
  assert.ok(!PATRON.test('llegará, enviará, después, inglés, estrés'), 'no debe marcar acentos legítimos');
  assert.ok(!PATRON.test('no entendí, capté, pregunté'), 'no debe marcar pretéritos de primera persona');
  assert.ok(exenta('- Español mexicano neutro SIEMPRE: nunca voseo ("podés", "tenés")'), 'la regla se exime');
  assert.ok(exenta('Disculpa, no te seguí bien.'), 'el pretérito legítimo se exime');
  assert.ok(!exenta('Probá con otro filtro'), 'una línea cualquiera NO se exime');
  assert.ok(PATRON.test('Al cerrar, contá dos cosas'), 'debe detectar voseo en el guion (.md)');
});

// La regla del presente tiene su propio control: si LEGITIMAS creciera de más, o
// si la exención del futuro se comiera un caso real, este test lo dice.
test('control negativo: la REGLA del presente detecta -ás/-és/-ís y respeta lo legítimo', () => {
  // El caso que la lista de negación dejaba pasar, y sus hermanos de familia.
  assert.equal(presenteDeVoseo('si trabajás esas franjas'), 'trabajás', '-ás: el hueco original');
  assert.equal(presenteDeVoseo('huecos que igual pagás'), 'pagás', '-ás');
  assert.equal(presenteDeVoseo('después tocás el hueco'), 'tocás', '-ás');
  assert.equal(presenteDeVoseo('suelta donde apuntás'), 'apuntás', '-ás');
  assert.equal(presenteDeVoseo('lo tenés arriba'), 'tenés', '-és');
  assert.equal(presenteDeVoseo('¿preferís otra hora?'), 'preferís', '-ís');
  // Un verbo que nadie enumeró nunca: el punto de que sea regla y no lista.
  assert.equal(presenteDeVoseo('vos manejás la agenda'), 'manejás', 'cubre verbos no enumerados');

  // Español neutro que NO debe caer.
  assert.equal(presenteDeVoseo('más, además, demás, jamás, quizás, atrás, detrás'), null);
  assert.equal(presenteDeVoseo('después del país, en inglés, con estrés'), null);
  assert.equal(presenteDeVoseo('¿cómo estás?'), null, 'tú de estar es neutro');
  assert.equal(presenteDeVoseo('Andrés atiende hoy'), null, 'nombre propio');
  assert.equal(presenteDeVoseo('podrás verás encontrarás recibirás consultarás'), null, 'futuro de tú');

  // El agujero conocido de la exención del futuro, cerrado a mano.
  assert.equal(presenteDeVoseo('si mirás la agenda'), 'mirás', 'voseo en -rás, recuperado');
  assert.equal(presenteDeVoseo('cuando entrás al local'), 'entrás', 'voseo en -rás, recuperado');
});
