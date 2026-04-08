// ─── Blocked Days ───────────────────────────────────────────────────────────────
// blockDay / unblockDay — exclusive to the `medical` profile.
// The doctor calls these from the dashboard to block or unblock entire days
// (vacations, conferences, personal days) without touching individual appointments.
//
// Timezone note: blocked_days.date is a DATE column (no time component).
// All Date objects are converted to 'YYYY-MM-DD' in the client's local timezone
// before writing to the DB — never in UTC.

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts a UTC Date to a 'YYYY-MM-DD' string in the given IANA timezone.
 * Uses Intl.DateTimeFormat — no external libraries.
 */
function dateToLocalDateStr(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// ─── Param types ───────────────────────────────────────────────────────────────

export interface BlockDayParams {
  readonly clientId: string;
  readonly specialistId: string;
  /** The day to block. Converted to local DATE using timezone before inserting. */
  readonly date: Date;
  /** Optional label shown in the UI (e.g. 'vacaciones', 'congreso'). */
  readonly reason?: string;
  readonly timezone: string;
  readonly supabase: SupabaseClient;
}

export interface UnblockDayParams {
  readonly clientId: string;
  readonly specialistId: string;
  /** The day to unblock. Converted to local DATE using timezone before querying. */
  readonly date: Date;
  readonly timezone: string;
  readonly supabase: SupabaseClient;
}

// ─── blockDay ──────────────────────────────────────────────────────────────────

/**
 * Blocks a full calendar day for a specialist.
 * Idempotent — uses ON CONFLICT DO NOTHING (UNIQUE constraint on client+specialist+date).
 * After this call, getAvailableSlots() will return zero slots for this date.
 *
 * @throws if the Supabase insert fails for reasons other than a duplicate.
 */
export async function blockDay(params: BlockDayParams): Promise<void> {
  const { clientId, specialistId, date, reason, timezone, supabase } = params;
  const dateStr = dateToLocalDateStr(date, timezone);

  const { error } = await supabase.from('blocked_days').insert({
    client_id:     clientId,
    specialist_id: specialistId,
    date:          dateStr,
    reason:        reason ?? null,
  });

  // Guard: ignore unique-violation (idempotent block)
  if (error && error.code !== '23505') {
    throw new Error(`blockDay failed for ${dateStr}: ${error.message}`);
  }
}

// ─── unblockDay ────────────────────────────────────────────────────────────────

/**
 * Removes a full-day block for a specialist.
 * Idempotent — no-ops silently if the day was not blocked.
 * After this call, getAvailableSlots() will resume generating slots for this date.
 *
 * @throws if the Supabase delete fails.
 */
export async function unblockDay(params: UnblockDayParams): Promise<void> {
  const { clientId, specialistId, date, timezone, supabase } = params;
  const dateStr = dateToLocalDateStr(date, timezone);

  const { error } = await supabase
    .from('blocked_days')
    .delete()
    .eq('client_id', clientId)
    .eq('specialist_id', specialistId)
    .eq('date', dateStr);

  if (error) {
    throw new Error(`unblockDay failed for ${dateStr}: ${error.message}`);
  }
}
