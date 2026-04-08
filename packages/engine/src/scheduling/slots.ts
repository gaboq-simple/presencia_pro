// ─── Slot Calculator ───────────────────────────────────────────────────────────
// generateAvailableSlots is a pure function — no side effects, no fetch.
// getAvailableSlots is the public orchestrator — queries Google Calendar and
// Supabase, then delegates to generateAvailableSlots.
//
// Timezone arithmetic uses Intl.DateTimeFormat.formatToParts only.
// No external date libraries (luxon, date-fns, dayjs).

import type { BusyPeriod, TimeSlot, OfficeHours, SlotConfig, GetAvailableSlotsParams } from './types';
import { getAccessToken, getFreeBusy } from './calendar';
import { createAppointmentRepository } from './appointmentRepository';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Maximum slots returned per call — the bot presents options, not a full calendar. */
const MAX_SLOTS_PER_CALL = 10;

/** Minimum advance booking window in milliseconds (2 hours). */
const MIN_ADVANCE_MS = 2 * 60 * 60_000;

// ─── Timezone helpers ──────────────────────────────────────────────────────────

/**
 * Returns the UTC offset in minutes for `date` in the given IANA timezone.
 * Uses formatToParts to read local hour/minute/second components, then
 * reconstructs a UTC epoch from them and compares to the actual UTC epoch.
 * Handles DST correctly because it reads the offset for the specific instant.
 */
function tzOffsetMinutes(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(date);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return parseInt(part?.value ?? '0', 10);
  };

  const year = get('year');
  const month = get('month') - 1;
  const day = get('day');
  let hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  // Intl formats midnight as 24 in some environments — normalise
  if (hour === 24) hour = 0;

  const localAsUtcMs = Date.UTC(year, month, day, hour, minute, second);
  return Math.round((localAsUtcMs - date.getTime()) / 60_000);
}

/**
 * Converts a local "HH:MM" time string on a specific calendar date (YYYY-MM-DD)
 * into a UTC Date, accounting for DST.
 */
function localTimeToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number];
  // Anchor at noon UTC — safe from DST transitions that occur at midnight/02:00
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const offsetMinutes = tzOffsetMinutes(anchor, timezone);
  const [hh, mm] = timeStr.split(':').map(Number) as [number, number];

  const localMinutes = hh * 60 + mm;
  const utcMinutes = localMinutes - offsetMinutes;

  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  utcDate.setUTCMinutes(utcDate.getUTCMinutes() + utcMinutes);

  // Refine: verify the offset at the computed UTC time (handles DST transitions)
  const refinedOffset = tzOffsetMinutes(utcDate, timezone);
  if (refinedOffset !== offsetMinutes) {
    utcDate.setUTCMinutes(utcDate.getUTCMinutes() + (offsetMinutes - refinedOffset));
  }

  return utcDate;
}

/**
 * Returns "YYYY-MM-DD" for a UTC Date in the given IANA timezone.
 */
function utcToLocalDate(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

/**
 * Returns the local day-of-week (0=Sun … 6=Sat) for a UTC Date in the
 * given IANA timezone.
 */
function localDayOfWeek(date: Date, timezone: string): number {
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName);
}

// ─── Overlap check ─────────────────────────────────────────────────────────────

/**
 * Returns true if [slotStart, slotEnd) overlaps with any busy period.
 * Uses half-open intervals [start, end) — consistent with Supabase overlap queries.
 */
function overlapsAnyBusy(
  slotStart: Date,
  slotEnd: Date,
  busy: readonly BusyPeriod[],
): boolean {
  for (const b of busy) {
    const bStart = new Date(b.start).getTime();
    const bEnd = new Date(b.end).getTime();
    if (slotStart.getTime() < bEnd && slotEnd.getTime() > bStart) return true;
  }
  return false;
}

// ─── Pure slot generator ───────────────────────────────────────────────────────

export interface GenerateSlotsParams {
  readonly busy: readonly BusyPeriod[];
  readonly timezone: string;
  readonly officeHours: OfficeHours;
  readonly slotConfig: SlotConfig;
  readonly serviceDurationMinutes: number;
  readonly specialistId: string;
  /** Start of the range (inclusive) — uses UTC day from this Date */
  readonly fromDate: Date;
  /** End of the range (inclusive) — uses UTC day from this Date */
  readonly toDate: Date;
}

/**
 * Generates all available TimeSlots within the given date range.
 * Pure function — no I/O. All busy periods must be pre-loaded by the caller.
 *
 * Algorithm per calendar day in [fromDate, toDate]:
 *  1. Skip if the day is not in officeHours.days
 *  2. Compute UTC start/end of the office window for that day
 *  3. Walk forward by (serviceDuration + buffer) minutes
 *  4. Each candidate slot [start, start+duration) is available if it doesn't
 *     overlap any busy period and ends at or before office close
 */
export function generateAvailableSlots(params: GenerateSlotsParams): readonly TimeSlot[] {
  const { busy, timezone, officeHours, slotConfig, serviceDurationMinutes, specialistId } =
    params;

  const stepMinutes = serviceDurationMinutes + slotConfig.bufferBetweenSlotsMinutes;
  const slots: TimeSlot[] = [];

  // Build UTC day boundaries from the Date objects
  const fromMs = Date.UTC(
    params.fromDate.getUTCFullYear(),
    params.fromDate.getUTCMonth(),
    params.fromDate.getUTCDate(),
  );
  const toMs = Date.UTC(
    params.toDate.getUTCFullYear(),
    params.toDate.getUTCMonth(),
    params.toDate.getUTCDate(),
  );

  let cursor = fromMs;

  while (cursor <= toMs) {
    const cursorDate = new Date(cursor);
    const dateStr = utcToLocalDate(cursorDate, timezone);
    const dow = localDayOfWeek(cursorDate, timezone);

    // Guard: skip days outside office hours
    if ((officeHours.days as readonly number[]).includes(dow)) {
      const officeStart = localTimeToUtc(dateStr, officeHours.start, timezone);
      const officeEnd = localTimeToUtc(dateStr, officeHours.end, timezone);

      let slotStart = new Date(officeStart);

      while (true) {
        const slotEnd = new Date(slotStart.getTime() + serviceDurationMinutes * 60_000);

        // Guard: slot must end at or before office close
        if (slotEnd.getTime() > officeEnd.getTime()) break;

        if (!overlapsAnyBusy(slotStart, slotEnd, busy)) {
          slots.push({
            startsAt: new Date(slotStart),
            endsAt: new Date(slotEnd),
            specialistId,
            available: true,
          });
        }

        slotStart = new Date(slotStart.getTime() + stepMinutes * 60_000);
      }
    }

    // Advance to next calendar day (DST crossing handled per-day by localTimeToUtc)
    cursor += 24 * 60 * 60_000;
  }

  return slots;
}

// ─── Public orchestrator ───────────────────────────────────────────────────────

/**
 * Returns up to 10 available TimeSlots for the given specialist and service.
 *
 * Flow:
 *  1. Cap dateRange to advanceBookingDays and enforce 2-hour minimum advance
 *  2. Fetch busy periods from Google Calendar (FreeBusy API)
 *  3. Fetch existing Supabase appointments for the range (includes emergency_blocked)
 *  4. Merge both sources into a single busy-period list
 *  5. Generate slots via generateAvailableSlots
 *  6. Return first 10 available slots
 */
export async function getAvailableSlots(
  params: GetAvailableSlotsParams,
): Promise<readonly TimeSlot[]> {
  const { config, credentials } = params;

  // ── Resolve specialist and service from config ───────────────────────────────
  const specialist = config.specialists.find((s) => s.id === params.specialistId);
  if (!specialist) throw new Error(`Specialist not found: ${params.specialistId}`);

  const service = config.services.find((s) => s.id === params.serviceId);
  if (!service) throw new Error(`Service not found: ${params.serviceId}`);

  // ── Apply booking window constraints ────────────────────────────────────────
  const now = new Date();
  const minStartMs = now.getTime() + MIN_ADVANCE_MS;
  const maxStartMs =
    now.getTime() + config.scheduling.advanceBookingDays * 24 * 60 * 60_000;

  // from: at least 2 hours from now
  const from = new Date(Math.max(params.dateRange.from.getTime(), minStartMs));
  // to: at most advanceBookingDays from now
  const to = new Date(Math.min(params.dateRange.to.getTime(), maxStartMs));

  // Guard: if the constrained range is empty, return no slots
  if (from.getTime() > to.getTime()) return [];

  // ── Convert config.bot.officeHours.days from 1=Mon…7=Sun to 0=Sun…6=Sat ────
  const officeDays = config.bot.officeHours.days.map((d) => (d === 7 ? 0 : d));

  const officeHours: import('./types').OfficeHours = {
    start: config.bot.officeHours.start,
    end: config.bot.officeHours.end,
    days: officeDays,
  };

  const slotConfig: import('./types').SlotConfig = {
    slotDurationMinutes: config.scheduling.slotDurationMinutes,
    bufferBetweenSlotsMinutes: config.scheduling.bufferBetweenSlotsMinutes,
    advanceBookingDays: config.scheduling.advanceBookingDays,
  };

  // ── Check blocked days in range ─────────────────────────────────────────────
  // Blocked days are full-day blocks set by the doctor (vacations, conferences).
  // Each blocked date is converted to a 24-hour BusyPeriod so that
  // generateAvailableSlots produces zero slots for that day.
  const { data: blockedRows } = await params.supabase
    .from('blocked_days')
    .select('date')
    .eq('client_id', params.clientId)
    .eq('specialist_id', params.specialistId)
    .gte('date', utcToLocalDate(from, config.client.timezone))
    .lte('date', utcToLocalDate(to, config.client.timezone));

  const blockedDayBusy: BusyPeriod[] = (blockedRows ?? []).map((row) => {
    const dayStart = localTimeToUtc(row.date as string, '00:00', config.client.timezone);
    const dayEnd   = localTimeToUtc(row.date as string, '23:59', config.client.timezone);
    // Make end exclusive: push one minute past 23:59 to cover the full day
    dayEnd.setUTCMinutes(dayEnd.getUTCMinutes() + 1);
    return { start: dayStart.toISOString(), end: dayEnd.toISOString() };
  });

  // ── Fetch Google Calendar busy periods ──────────────────────────────────────
  const accessToken = await getAccessToken(credentials);
  const calendarBusy = await getFreeBusy(
    specialist.calendarId,
    from,
    to,
    config.client.timezone,
    accessToken,
  );

  // ── Fetch Supabase appointments (includes emergency_blocked) ────────────────
  const repo = createAppointmentRepository(params.supabase);
  const existingAppointments = await repo.findBySpecialistAndRange(
    params.clientId,
    params.specialistId,
    from,
    to,
  );

  const supabaseBusy: BusyPeriod[] = existingAppointments.map((a) => ({
    start: a.startsAt.toISOString(),
    end: a.endsAt.toISOString(),
  }));

  // ── Merge all busy periods ──────────────────────────────────────────────────
  const allBusy: readonly BusyPeriod[] = [...blockedDayBusy, ...calendarBusy, ...supabaseBusy];

  // ── Generate slots ──────────────────────────────────────────────────────────
  const allSlots = generateAvailableSlots({
    busy: allBusy,
    timezone: config.client.timezone,
    officeHours,
    slotConfig,
    serviceDurationMinutes: service.durationMinutes,
    specialistId: params.specialistId,
    fromDate: from,
    toDate: to,
  });

  // ── Filter out slots that are in the past or within the 2-hour minimum ──────
  const validSlots = allSlots.filter((s) => s.startsAt.getTime() >= minStartMs);

  return validSlots.slice(0, MAX_SLOTS_PER_CALL);
}
