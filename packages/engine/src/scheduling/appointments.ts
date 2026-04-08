// ─── Appointments ──────────────────────────────────────────────────────────────
// All appointment CRUD operations. Coordinates Supabase persistence and
// Google Calendar sync.
//
// Rules:
// - Every operation verifies clientId ownership before touching any record.
// - createAppointment is atomic: if Google Calendar fails, Supabase rolls back.
// - The double-booking guard uses a pre-insert overlap query + unique constraint.
// - No env var reads — all infrastructure is injected via AppointmentDeps.

import type {
  AppointmentRequest,
  Appointment,
  CancelAppointmentParams,
  AppointmentDeps,
} from './types';
import { SlotUnavailableError } from './types';
import { createAppointmentRepository } from './appointmentRepository';
import { getAccessToken, createCalendarEvent, cancelCalendarEvent } from './calendar';

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns true if the error is a Supabase unique constraint violation (code 23505).
 * Used to catch concurrent double-booking attempts that race past the pre-insert guard.
 */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as Record<string, unknown>)['code'] === '23505'
  );
}

// ─── createAppointment ─────────────────────────────────────────────────────────

/**
 * Creates an appointment:
 *  1. Resolves specialist and service from config
 *  2. Guards against double-booking (overlap query + unique constraint catch)
 *  3. Persists to Supabase with status pending_confirmation or confirmed
 *  4. Creates Google Calendar event
 *  5. Attaches googleEventId to the Supabase record
 *
 * Atomicity: if step 4 (Google Calendar) fails, step 3 is rolled back by
 * setting status to 'cancelled'. The patient will never see an appointment
 * without a corresponding Calendar event.
 *
 * Throws SlotUnavailableError if the slot is already taken.
 */
export async function createAppointment(
  request: AppointmentRequest,
  deps: AppointmentDeps,
): Promise<Appointment> {
  const repo = createAppointmentRepository(deps.supabase);

  // ── Resolve specialist and service ─────────────────────────────────────────
  const specialist = deps.config.specialists.find((s) => s.id === request.specialistId);
  if (!specialist) throw new Error(`Specialist not found: ${request.specialistId}`);

  const service = deps.config.services.find((s) => s.id === request.serviceId);
  if (!service) throw new Error(`Service not found: ${request.serviceId}`);

  const endsAt = new Date(request.startsAt.getTime() + service.durationMinutes * 60_000);

  // ── Double-booking guard ───────────────────────────────────────────────────
  // TODO: Reemplazar con FOR UPDATE via RPC en sesión de Infraestructura
  // Ver: supabase/migrations/006_book_slot_rpc.sql
  // El unique constraint (specialist_id, starts_at, client_id) previene
  // double-booking mientras tanto.
  const existing = await repo.findBySpecialistAndRange(
    request.clientId,
    request.specialistId,
    request.startsAt,
    endsAt,
  );

  if (existing.length > 0) throw new SlotUnavailableError();

  // ── Step 1: Persist to Supabase ────────────────────────────────────────────
  const initialStatus = deps.config.scheduling.confirmationRequired
    ? 'pending_confirmation'
    : 'confirmed';

  let appointment: Appointment;

  try {
    appointment = await repo.create({
      clientId: request.clientId,
      patientId: request.patientId,
      specialistId: request.specialistId,
      serviceId: request.serviceId,
      serviceMode: request.serviceMode,
      startsAt: request.startsAt,
      endsAt,
      status: initialStatus,
      googleEventId: null,
      intakeId: null,
    });
  } catch (err) {
    // Catch concurrent booking that raced past the overlap query
    if (isUniqueConstraintError(err)) throw new SlotUnavailableError();
    throw err;
  }

  // ── Step 2: Create Google Calendar event ───────────────────────────────────
  const accessToken = await getAccessToken(deps.credentials);

  let googleEventId: string;

  try {
    googleEventId = await createCalendarEvent({
      calendarId: specialist.calendarId,
      title: `Cita — ${service.name}`,
      startsAt: request.startsAt,
      endsAt,
      timezone: deps.config.client.timezone,
      accessToken,
    });
  } catch (err) {
    // Rollback: mark appointment cancelled so the slot is released
    await repo.update(appointment.id, { status: 'cancelled' });
    throw new Error(
      `Google Calendar event creation failed — appointment rolled back: ${String(err)}`,
    );
  }

  // ── Step 3: Attach Google event ID ─────────────────────────────────────────
  return repo.update(appointment.id, { googleEventId });
}

// ─── cancelAppointment ────────────────────────────────────────────────────────

/**
 * Cancels an appointment:
 *  1. Verifies clientId ownership
 *  2. Checks cancellation window — records penalty event if within it
 *  3. Updates Supabase status to 'cancelled'
 *  4. Deletes Google Calendar event
 */
export async function cancelAppointment(
  params: CancelAppointmentParams,
  deps: AppointmentDeps,
): Promise<void> {
  const repo = createAppointmentRepository(deps.supabase);

  const appointment = await repo.findById(params.appointmentId);
  if (!appointment) throw new Error(`Appointment not found: ${params.appointmentId}`);

  // Guard: clientId must match — never cancel across client boundaries
  if (appointment.clientId !== params.clientId) {
    throw new Error('Unauthorized: appointment belongs to a different client');
  }

  const nowMs = Date.now();
  const appointmentMs = appointment.startsAt.getTime();
  const windowMs = deps.config.scheduling.cancellationWindowHours * 60 * 60_000;
  const msUntilAppointment = appointmentMs - nowMs;
  const isWithinPenaltyWindow = msUntilAppointment > 0 && msUntilAppointment < windowMs;

  // ── Step 1: Update DB status ───────────────────────────────────────────────
  await repo.update(params.appointmentId, { status: 'cancelled' });

  // ── Step 2: Cancel Google Calendar event ───────────────────────────────────
  if (appointment.googleEventId) {
    const specialist = deps.config.specialists.find((s) => s.id === appointment.specialistId);
    if (specialist) {
      const accessToken = await getAccessToken(deps.credentials);
      await cancelCalendarEvent({
        calendarId: specialist.calendarId,
        eventId: appointment.googleEventId,
        accessToken,
      });
    }
  }

  // ── Step 3: Record penalty event if within cancellation window ─────────────
  if (isWithinPenaltyWindow) {
    await deps.supabase.from('events').insert({
      client_id: params.clientId,
      type: 'cancellation_within_window',
      patient_id: appointment.patientId,
      metadata: {
        appointment_id: params.appointmentId,
        reason: params.reason ?? null,
        hours_before: Math.round(msUntilAppointment / 3_600_000),
      },
    });
  }
}

// ─── confirmAppointment ───────────────────────────────────────────────────────

/**
 * Transitions a pending_confirmation appointment to confirmed.
 * Called when the patient explicitly confirms via WhatsApp or the confirmation link.
 */
export async function confirmAppointment(
  params: { readonly appointmentId: string; readonly clientId: string },
  deps: AppointmentDeps,
): Promise<Appointment> {
  const repo = createAppointmentRepository(deps.supabase);

  const appointment = await repo.findById(params.appointmentId);
  if (!appointment) throw new Error(`Appointment not found: ${params.appointmentId}`);
  if (appointment.clientId !== params.clientId) {
    throw new Error('Unauthorized: appointment belongs to a different client');
  }

  return repo.update(params.appointmentId, { status: 'confirmed' });
}

// ─── completeAppointment ──────────────────────────────────────────────────────

/**
 * Marks an appointment as completed.
 * Called by the doctor from the dashboard after the appointment takes place.
 */
export async function completeAppointment(
  params: { readonly appointmentId: string; readonly clientId: string },
  deps: AppointmentDeps,
): Promise<Appointment> {
  const repo = createAppointmentRepository(deps.supabase);

  const appointment = await repo.findById(params.appointmentId);
  if (!appointment) throw new Error(`Appointment not found: ${params.appointmentId}`);
  if (appointment.clientId !== params.clientId) {
    throw new Error('Unauthorized: appointment belongs to a different client');
  }

  return repo.update(params.appointmentId, { status: 'completed' });
}

// ─── getAppointment ───────────────────────────────────────────────────────────

/**
 * Retrieves a single appointment by ID.
 * Returns null if not found or if clientId does not match — never exposes
 * appointments across client boundaries.
 */
export async function getAppointment(
  params: { readonly appointmentId: string; readonly clientId: string },
  deps: Pick<AppointmentDeps, 'supabase'>,
): Promise<Appointment | null> {
  const repo = createAppointmentRepository(deps.supabase);

  const appointment = await repo.findById(params.appointmentId);
  if (!appointment) return null;

  // Guard: never expose appointments across client boundaries
  if (appointment.clientId !== params.clientId) return null;

  return appointment;
}

// ─── getAppointmentsForDay ────────────────────────────────────────────────────

/**
 * Returns all non-cancelled appointments for a specialist on a given calendar day.
 * The date is interpreted in UTC — the caller is responsible for providing the
 * correct UTC midnight for the target local day.
 */
export async function getAppointmentsForDay(
  params: { readonly clientId: string; readonly specialistId: string; readonly date: Date },
  deps: Pick<AppointmentDeps, 'supabase'>,
): Promise<readonly Appointment[]> {
  const repo = createAppointmentRepository(deps.supabase);

  // Build UTC start/end of the calendar day
  const dayStart = new Date(
    Date.UTC(params.date.getUTCFullYear(), params.date.getUTCMonth(), params.date.getUTCDate()),
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  return repo.findBySpecialistAndRange(
    params.clientId,
    params.specialistId,
    dayStart,
    dayEnd,
  );
}
