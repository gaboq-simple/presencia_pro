// ─── Emergency Slot Management ─────────────────────────────────────────────────
// Emergency slots are appointments persisted with status 'emergency_blocked'.
// They are invisible to patients — they appear as occupied time to any slot
// availability query, because findBySpecialistAndRange includes them.
//
// The doctor releases them from the dashboard when a real urgent case arrives.
// On release, the status changes to 'pending' and the Calendar event is deleted
// so that createAppointment can re-create it with the patient's name.

import type { EmergencyDeps } from './types';
import { createAppointmentRepository } from './appointmentRepository';
import { getAccessToken, createCalendarEvent, cancelCalendarEvent } from './calendar';
import { generateAvailableSlots } from './slots';

// ─── blockEmergencySlots ──────────────────────────────────────────────────────

/**
 * Blocks N emergency slots for the given specialist on the given date.
 * N = config.scheduling.emergencySlotsPerDay.
 *
 * Flow:
 *  1. Fetch existing appointments for the day to build a busy-period list
 *  2. Generate all possible slots via the pure slot calculator
 *  3. Take the first N available slots
 *  4. Persist each as an 'emergency_blocked' appointment in Supabase
 *  5. Create a private Google Calendar event ([BLOQUEADO]) for each
 *
 * Called automatically at the start of each business day (externally triggered
 * — e.g., a cron job or a Supabase Edge Function). Idempotent: if slots are
 * already blocked for the day they will show up as busy and won't be re-blocked.
 */
export async function blockEmergencySlots(
  params: {
    readonly clientId: string;
    readonly specialistId: string;
    readonly date: Date;
  },
  deps: EmergencyDeps,
): Promise<void> {
  const { config } = deps;
  const count = config.scheduling.emergencySlotsPerDay;

  // Guard: nothing to block
  if (count === 0) return;

  const specialist = config.specialists.find((s) => s.id === params.specialistId);
  if (!specialist) throw new Error(`Specialist not found: ${params.specialistId}`);

  const repo = createAppointmentRepository(deps.supabase);

  // ── Build busy periods from existing appointments for the day ───────────────
  const dayStart = new Date(
    Date.UTC(params.date.getUTCFullYear(), params.date.getUTCMonth(), params.date.getUTCDate()),
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const existingAppointments = await repo.findBySpecialistAndRange(
    params.clientId,
    params.specialistId,
    dayStart,
    dayEnd,
  );

  const busyPeriods = existingAppointments.map((a) => ({
    start: a.startsAt.toISOString(),
    end: a.endsAt.toISOString(),
  }));

  // ── Convert config office hours days: 1=Mon…7=Sun → 0=Sun…6=Sat ────────────
  const officeDays = config.bot.officeHours.days.map((d) => (d === 7 ? 0 : d));

  // ── Generate all available slots for the day ────────────────────────────────
  const allSlots = generateAvailableSlots({
    busy: busyPeriods,
    timezone: config.client.timezone,
    officeHours: {
      start: config.bot.officeHours.start,
      end: config.bot.officeHours.end,
      days: officeDays,
    },
    slotConfig: {
      slotDurationMinutes: config.scheduling.slotDurationMinutes,
      bufferBetweenSlotsMinutes: config.scheduling.bufferBetweenSlotsMinutes,
      advanceBookingDays: config.scheduling.advanceBookingDays,
    },
    serviceDurationMinutes: config.scheduling.slotDurationMinutes,
    specialistId: params.specialistId,
    fromDate: params.date,
    toDate: params.date,
  });

  const slotsToBlock = allSlots.slice(0, count);

  // Guard: no slots available to block on this day
  if (slotsToBlock.length === 0) return;

  const accessToken = await getAccessToken(deps.credentials);

  // ── Block each slot ─────────────────────────────────────────────────────────
  for (const slot of slotsToBlock) {
    // Persist to Supabase first — patientId is null (no patient for emergency slots)
    const appointment = await repo.create({
      clientId: params.clientId,
      patientId: null,
      specialistId: params.specialistId,
      serviceId: 'emergency-blocked',  // sentinel value — not a real service ID
      serviceMode: 'consultorio',       // irrelevant for blocked slots
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: 'emergency_blocked',
      googleEventId: null,
      intakeId: null,
    });

    // Create private Calendar event — [BLOQUEADO] is invisible to shared calendar views
    const eventId = await createCalendarEvent({
      calendarId: specialist.calendarId,
      title: '[BLOQUEADO]',
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      timezone: config.client.timezone,
      accessToken,
      visibility: 'private',
    });

    // Attach Google event ID
    await repo.update(appointment.id, { googleEventId: eventId });
  }
}

// ─── isEmergencySlot ─────────────────────────────────────────────────────────

/**
 * Returns true if there is an emergency_blocked appointment for the given
 * specialist that starts at the given time.
 *
 * Used by the dashboard to indicate which slots are emergency-reserved.
 */
export async function isEmergencySlot(
  params: {
    readonly startsAt: Date;
    readonly clientId: string;
    readonly specialistId: string;
  },
  deps: Pick<EmergencyDeps, 'supabase'>,
): Promise<boolean> {
  // Query for an emergency_blocked appointment that starts exactly at startsAt.
  // We use a 1-minute window (±30s) to tolerate minor rounding from ISO conversion.
  const windowMs = 30_000;
  const from = new Date(params.startsAt.getTime() - windowMs);
  const to = new Date(params.startsAt.getTime() + windowMs);

  const { data, error } = await deps.supabase
    .from('appointments')
    .select('id')
    .eq('client_id', params.clientId)
    .eq('specialist_id', params.specialistId)
    .eq('status', 'emergency_blocked')
    .gte('starts_at', from.toISOString())
    .lte('starts_at', to.toISOString())
    .limit(1);

  if (error) throw new Error(`isEmergencySlot failed: ${error.message}`);
  return (data ?? []).length > 0;
}

// ─── releaseEmergencySlot ─────────────────────────────────────────────────────

/**
 * Releases an emergency slot so it can be booked by a real patient.
 *
 * Flow:
 *  1. Find the emergency_blocked appointment for this specialist + startsAt
 *  2. Delete the private [BLOQUEADO] Calendar event
 *  3. Update status to 'pending' — the slot is now available for createAppointment
 *
 * After release, the bot can offer this slot normally. When the patient books it,
 * createAppointment will create a proper Calendar event with the patient's name.
 */
export async function releaseEmergencySlot(
  params: {
    readonly clientId: string;
    readonly specialistId: string;
    readonly startsAt: Date;
  },
  deps: EmergencyDeps,
): Promise<void> {
  const specialist = deps.config.specialists.find((s) => s.id === params.specialistId);
  if (!specialist) throw new Error(`Specialist not found: ${params.specialistId}`);

  // ── Find the emergency_blocked record ──────────────────────────────────────
  const windowMs = 30_000;
  const from = new Date(params.startsAt.getTime() - windowMs);
  const to = new Date(params.startsAt.getTime() + windowMs);

  const { data, error } = await deps.supabase
    .from('appointments')
    .select('*')
    .eq('client_id', params.clientId)
    .eq('specialist_id', params.specialistId)
    .eq('status', 'emergency_blocked')
    .gte('starts_at', from.toISOString())
    .lte('starts_at', to.toISOString())
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(
      `No emergency_blocked slot found for specialist ${params.specialistId} at ${params.startsAt.toISOString()}`,
    );
  }

  const record = data as { id: string; google_event_id: string | null };

  // ── Delete the private [BLOQUEADO] Calendar event ──────────────────────────
  if (record.google_event_id) {
    const accessToken = await getAccessToken(deps.credentials);
    await cancelCalendarEvent({
      calendarId: specialist.calendarId,
      eventId: record.google_event_id,
      accessToken,
    });
  }

  // ── Release the slot — mark as pending so it appears available ──────────────
  const repo = createAppointmentRepository(deps.supabase);
  await repo.update(record.id, { status: 'pending', googleEventId: null });
}
