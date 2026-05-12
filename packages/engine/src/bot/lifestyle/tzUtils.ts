// ─── Lifestyle Bot — Timezone Utilities ───────────────────────────────────────
// Todas las operaciones de fecha/hora deben recibir el timezone del negocio.
// Nunca asumir el timezone del servidor (UTC en Vercel).
//
// Implementación: solo Intl.DateTimeFormat — sin moment, luxon, date-fns-tz.
// Misma técnica que packages/engine/src/scheduling/slots.ts (tzOffsetMinutes).

// ─── Offset UTC ───────────────────────────────────────────────────────────────

/**
 * Retorna el offset UTC en minutos para `date` en el timezone dado.
 * Maneja DST correctamente porque lee el offset para el instante específico.
 */
function tzOffsetMinutes(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   false,
  });

  const parts = fmt.formatToParts(date);
  const get   = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return parseInt(part?.value ?? '0', 10);
  };

  const year   = get('year');
  const month  = get('month') - 1;
  const day    = get('day');
  let   hour   = get('hour');
  const minute = get('minute');
  const second = get('second');

  // Algunos entornos formatean la medianoche como 24
  if (hour === 24) hour = 0;

  const localAsUtcMs = Date.UTC(year, month, day, hour, minute, second);
  return Math.round((localAsUtcMs - date.getTime()) / 60_000);
}

// ─── Conversión UTC → fecha local ─────────────────────────────────────────────

/**
 * Retorna "YYYY-MM-DD" para un Date UTC en el timezone del negocio.
 * Equivalente a toLocaleDateString('sv-SE', { timeZone }) pero con 'en-CA'
 * que también produce el formato ISO.
 */
export function utcToLocalDateStr(utc: Date, tz: string): string {
  return utc.toLocaleDateString('en-CA', { timeZone: tz });
}

/**
 * Retorna los minutos desde medianoche (0–1439) para un Date UTC
 * convertido al timezone del negocio.
 */
export function utcToLocalMinutes(utc: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });
  const parts = fmt.formatToParts(utc);
  const get   = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return parseInt(part?.value ?? '0', 10);
  };
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return hour * 60 + get('minute');
}

// ─── Conversión hora local → UTC ──────────────────────────────────────────────

/**
 * Convierte una hora local "HH:MM" en una fecha YYYY-MM-DD (ya en TZ del
 * negocio) a un Date UTC. Maneja DST correctamente con un refinamiento.
 *
 * Mismo algoritmo que packages/engine/src/scheduling/slots.ts:localTimeToUtc.
 */
export function localTimeToUTC(dateStr: string, timeStr: string, tz: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number];
  // Anclar al mediodía UTC — seguro contra transiciones DST que ocurren a las 00:00/02:00
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const offsetMinutes = tzOffsetMinutes(anchor, tz);
  const [hh, mm]      = timeStr.split(':').map(Number) as [number, number];

  const localMinutes = hh * 60 + mm;
  const utcMinutes   = localMinutes - offsetMinutes;

  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  utcDate.setUTCMinutes(utcDate.getUTCMinutes() + utcMinutes);

  // Refinamiento: verificar el offset en el UTC calculado (cubre transiciones DST)
  const refinedOffset = tzOffsetMinutes(utcDate, tz);
  if (refinedOffset !== offsetMinutes) {
    utcDate.setUTCMinutes(utcDate.getUTCMinutes() + (offsetMinutes - refinedOffset));
  }

  return utcDate;
}

// ─── Helpers de fecha local ───────────────────────────────────────────────────

/**
 * Retorna "YYYY-MM-DD" del día actual en el timezone del negocio.
 */
export function getTodayStr(tz: string): string {
  return utcToLocalDateStr(new Date(), tz);
}

/**
 * Retorna true si dos Dates UTC caen en el mismo día calendario
 * en el timezone del negocio.
 */
export function isSameDayInTZ(a: Date, b: Date, tz: string): boolean {
  return utcToLocalDateStr(a, tz) === utcToLocalDateStr(b, tz);
}

/**
 * Construye un Date a las 12:00 UTC del día indicado como "YYYY-MM-DD".
 *
 * Útil para representar un día local como Date: al usar `.getDate()`,
 * `.getDay()`, etc. en servidor UTC, el mediodía UTC siempre cae en el
 * mismo día que el mediodía local en cualquier timezone de México.
 *
 * NO usar para representar "el inicio del día" — usar localTimeToUTC para eso.
 */
export function noonUTCDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}
