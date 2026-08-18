// ─── Viz — matemática PURA del kit de gráficas (sin DB, sin red, sin React) ───
// Traduce números de negocio a los pocos parámetros que las formas del sistema
// entienden: un ancho en %, un escalón de rampa, y el pliegue de la cola larga.
// Todo lo que decide CUÁNTO se pinta vive acá y se prueba con números conocidos;
// los componentes de components/admin/viz/ solo pintan lo que esta capa dice.
//
// Reglas del sistema que estas funciones ENCARNAN (no las re-decida el caller):
//   · MAGNITUD = un solo matiz (la rampa secuencial teal). Nunca la categórica.
//   · IDENTIDAD = la categórica en ORDEN FIJO (el orden es el mecanismo de
//     seguridad para daltonismo) — eso lo aplica el componente, no esta capa.
//   · Un valor > 0 SIEMPRE deja huella visible: una barra de 0.3px es una mentira
//     por redondeo (parece cero cuando no lo es) — de ahí el mínimo del 2%.
//   · La cola larga se PLIEGA en "Otros", nunca se inventa una 6ª serie ni se
//     esconde: el pliegue conserva la suma.

/** Ancho de barra en % (0–100) de `valor` contra el máximo de su serie.
 *  Mínimo visual de 2% cuando el valor es > 0 (ver regla arriba). Devuelve 0 solo
 *  para el cero real. Redondeado a 2 decimales: el número va a un `style` inline y
 *  no hace falta arrastrar 14 decimales de coma flotante. */
export function pctWidth(valor: number, max: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(max)) return 0;
  if (valor <= 0 || max <= 0) return 0;
  const raw = (valor / max) * 100;
  const clamped = Math.min(100, Math.max(MIN_VISIBLE_PCT, raw));
  return Math.round(clamped * 100) / 100;
}

/** Piso visual (%) de una barra con valor > 0. */
export const MIN_VISIBLE_PCT = 2;

/** Escalón 1..7 de la rampa secuencial teal (--color-viz-seq-N) para una
 *  intensidad normalizada 0..1. 0 → el más claro; 1 (o más) → el más oscuro.
 *  Fuera de rango o NaN → 1 (nunca revienta ni pinta un token inexistente). */
export function seqStep(intensidad: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return bucket(intensidad, SEQ_STEPS) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** Escalón 1..4 de la rampa de HUECO (--color-viz-hueco-N) para `horas` de
 *  capacidad sin usar contra el máximo de la vista. Rampa propia y ámbar tenue a
 *  propósito: un hueco es capacidad sin usar, no una alarma (nunca rojo). */
export function huecoStep(horas: number, maxHoras: number): 1 | 2 | 3 | 4 {
  if (!Number.isFinite(horas) || !Number.isFinite(maxHoras) || maxHoras <= 0) return 1;
  return bucket(horas / maxHoras, HUECO_STEPS) as 1 | 2 | 3 | 4;
}

const SEQ_STEPS = 7;
const HUECO_STEPS = 4;

// Reparte [0,1] en `steps` cubetas de igual ancho y devuelve 1..steps.
function bucket(fraccion: number, steps: number): number {
  if (!Number.isFinite(fraccion) || fraccion <= 0) return 1;
  return Math.min(steps, Math.max(1, 1 + Math.floor(fraccion * steps)));
}

/** Fila de una gráfica de identidad (servicio, barbero, canal…). */
export type VizRow = { label: string; value: number };

/** Fila de salida: la del pliegue viene marcada para que el componente la pinte
 *  con --color-viz-otros y no la confunda con una serie real (marcarla es más
 *  robusto que adivinar por el texto del label). */
export type VizFoldedRow = VizRow & { esOtros?: true; agrupadas?: number };

/** Top-N por valor + una fila "Otros k" que suma el resto.
 *  Orden descendente por valor; los empates conservan el orden de entrada (sort
 *  estable) → salida determinista. Con `tope` o menos filas devuelve las filas
 *  ordenadas y NADA más (no inventa un "Otros 0"). La suma total se conserva
 *  siempre: plegar no es esconder. */
export function foldOtros(filas: readonly VizRow[], tope: number): VizFoldedRow[] {
  const n = Math.max(1, Math.floor(tope));
  const ordenadas = [...filas].sort((a, b) => b.value - a.value);
  if (ordenadas.length <= n) return ordenadas;

  const visibles = ordenadas.slice(0, n);
  const resto = ordenadas.slice(n);
  const suma = resto.reduce((acc, f) => acc + f.value, 0);
  return [
    ...visibles,
    { label: `Otros ${resto.length}`, value: suma, esOtros: true, agrupadas: resto.length },
  ];
}

/** Reparte 100% entre los valores de una composición, conservando la suma.
 *
 * `pctWidth` NO sirve acá: mide contra el MÁXIMO de la serie (magnitud), y una
 * apilada mide contra el TOTAL (proporción). Usar una donde va la otra da una
 * barra que suma 240% y parece correcta.
 *
 * Dos cosas que esta función garantiza y que a mano se pierden siempre:
 *
 *   · **La suma es exactamente 100** cuando hay algún valor > 0. Redondear cinco
 *     porcentajes por separado deja un hueco (o un desborde) de hasta medio punto,
 *     y en una barra con `overflow:hidden` eso se ve como un mordisco en el último
 *     segmento. El residuo se le da al segmento más grande, que es donde menos se
 *     nota en términos relativos.
 *   · **Un valor > 0 nunca desaparece.** Con 125 clientes, un segmento de 1 es el
 *     0.8% y a 375px eso es menos de tres píxeles: se redondearía a 0 y el grupo
 *     se volvería invisible justo cuando aparece. El piso es 1% —más chico que el
 *     de `pctWidth`, porque acá cada punto que se le regala a uno se le quita a
 *     otro— y se descuenta proporcionalmente del resto.
 *
 * Los ceros salen en 0: un grupo vacío no ocupa lugar.
 */
export function sharePcts(valores: readonly number[]): number[] {
  const limpios = valores.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = limpios.reduce((a, b) => a + b, 0);
  if (total <= 0) return limpios.map(() => 0);

  const MIN = MIN_SHARE_PCT;
  const crudos = limpios.map((v) => (v / total) * 100);

  // Piso: lo que se le sube a los chicos se le baja a los grandes, en proporción
  // a lo que tienen de más — así el orden relativo se conserva.
  const bajoPiso = crudos.map((p, i) => (limpios[i]! > 0 && p < MIN ? MIN - p : 0));
  const deuda = bajoPiso.reduce((a, b) => a + b, 0);
  const sobrante = crudos.reduce((a, p, i) => a + (bajoPiso[i]! > 0 ? 0 : Math.max(0, p - MIN)), 0);
  const ajustados = crudos.map((p, i) => {
    if (limpios[i] === 0) return 0;
    if (bajoPiso[i]! > 0) return MIN;
    if (sobrante <= 0) return p;
    return p - (deuda * Math.max(0, p - MIN)) / sobrante;
  });

  // Redondeo a 2 decimales y el residuo al más grande (una sola pasada, determinista).
  const redondeados = ajustados.map((p) => Math.round(p * 100) / 100);
  const suma = redondeados.reduce((a, b) => a + b, 0);
  const resto = Math.round((100 - suma) * 100) / 100;
  if (resto !== 0) {
    let iMax = -1;
    for (let i = 0; i < redondeados.length; i++) {
      if (redondeados[i]! > 0 && (iMax === -1 || redondeados[i]! > redondeados[iMax]!)) iMax = i;
    }
    if (iMax >= 0) redondeados[iMax] = Math.round((redondeados[iMax]! + resto) * 100) / 100;
  }
  return redondeados;
}

/** Piso de un segmento con valor > 0 en una composición 100%. */
export const MIN_SHARE_PCT = 1;
