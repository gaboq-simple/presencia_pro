// ─── dayWindow — límites de día tz-aware ──────────────────────────────────────
// Helpers PUROS (solo Intl/Date, sin red/DB) para convertir una hora-de-pared del
// negocio a un instante UTC, y para acotar un día a la timezone del negocio.
//
// Viven acá (módulo puro, client-safe) y NO en dashboard.types.ts —que importa la
// data-layer (supabase-js, tenantDb)— para que un Client Component (p.ej.
// EndOfDaySummary) pueda usar `localDayRangeUtc` sin arrastrar el service_role al
// bundle. dashboard.types.ts los re-exporta para que los importadores existentes
// (`import ... from '@/lib/dashboard.types'`) sigan andando sin cambios.

/**
 * Interpreta una hora-de-pared `dateStr`+`timeStr` como hora del NEGOCIO (`timeZone`)
 * y devuelve el instante UTC correspondiente. No depende de la tz del servidor
 * (Vercel = UTC), a diferencia de `new Date('YYYY-MM-DDTHH:MM:SS')`.
 *
 * Exportado (S6-DATA-01): `rescheduleAppointment` lo usa para interpretar la
 * hora-de-pared que recibe como hora del NEGOCIO (no del servidor Vercel=UTC).
 */
export function zonedWallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const asIfUtc = new Date(`${dateStr}T${timeStr}Z`).getTime();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(asIfUtc));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const localAsUtc = Date.UTC(
    Number(m['year']),
    Number(m['month']) - 1,
    Number(m['day']),
    Number(m['hour'] === '24' ? '0' : m['hour']),
    Number(m['minute']),
    Number(m['second']),
  );
  return new Date(asIfUtc - (localAsUtc - asIfUtc));
}

/**
 * "Hoy" ('YYYY-MM-DD') en la timezone del NEGOCIO — la única fuente de verdad.
 *
 * Nunca `new Date().toISOString().slice(0,10)` ni `toDateStr(new Date())`: esos
 * leen la tz del proceso (Vercel = UTC) o del browser, y después de las 18:00 en
 * México (UTC-6) ya devuelven el día SIGUIENTE — el barbero abría /staff de noche
 * y veía su día vacío. Nombre IANA siempre, jamás un offset hardcodeado.
 *
 * `now` es inyectable solo para tests deterministas.
 */
export function todayStrInTz(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** ¿`dateStr` es hoy en la tz del negocio? Definido sobre todayStrInTz (una sola fuente). */
export function isTodayInTz(dateStr: string, timeZone: string, now: Date = new Date()): boolean {
  return dateStr === todayStrInTz(timeZone, now);
}

/**
 * Rango `[inicio, fin)` del día `date` en la tz del negocio, como instantes UTC ISO.
 * El día local va de 00:00 a 00:00 del día siguiente. Exportado para que otras
 * queries del día (bloqueos, etc.) usen los mismos límites tz-correctos.
 */
export function localDayRangeUtc(date: string, timeZone: string): { start: string; end: string } {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextStr = next.toISOString().slice(0, 10);
  return {
    start: zonedWallTimeToUtc(date, '00:00:00', timeZone).toISOString(),
    end: zonedWallTimeToUtc(nextStr, '00:00:00', timeZone).toISOString(),
  };
}
