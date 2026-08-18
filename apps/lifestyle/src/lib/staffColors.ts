// ─── staffColors — la asignación de IDENTIDAD de la pestaña Administrar ──────
// Módulo puro (sin DB, sin red, sin React). Una sola pregunta: qué color
// categórico le toca a cada barbero.
//
// Vive aparte porque lo consumen DOS piezas que se miran entre sí — el riel del
// día y la tabla del equipo. Si cada una resolviera su color, el punto de Miguel
// en el equipo y su barra en el riel podrían no ser el mismo, y la leyenda del
// héroe dejaría de servir para leer las dos.
//
// La regla del sistema (kit dv3-2): la categórica va por POSICIÓN en un orden
// FIJO, nunca por valor — el orden es el mecanismo de seguridad para daltonismo.
// Acá el orden fijo es ALFABÉTICO por nombre, y eso es deliberado: es el único
// que no se mueve cuando se mueve la métrica. Si el color saliera del ranking de
// ingresos, el color de un barbero cambiaría de una semana a otra y dejaría de
// ser su identidad (además de convertir la paleta en un ranking encubierto, lo
// mismo que `staffRecompra` evita ordenando alfabéticamente).

export type StaffIdentidad = { id: string; name: string };

/**
 * Mapa staff_id → índice categórico (0-based), por orden alfabético de nombre.
 *
 * El índice se pasa tal cual a `colorCategorico` del kit, que ya cicla la paleta
 * de 5 con `% PALETA.length`: con más de 5 barberos dos comparten color, y eso
 * es preferible a inventar una 6ª serie (regla del sistema). El desempate por
 * `id` mantiene la salida determinista ante nombres repetidos — hay negocios con
 * dos Carlos, y ya nos costó una vez.
 */
export function staffColorIndex(staff: readonly StaffIdentidad[]): Map<string, number> {
  const ordenados = [...staff].sort(
    (a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id),
  );
  return new Map(ordenados.map((s, i) => [s.id, i]));
}
