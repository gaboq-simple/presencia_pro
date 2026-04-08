// ─── Appointment Repository ────────────────────────────────────────────────────
// Interface-first pattern. Engine depends only on IAppointmentRepository.
// Supabase implementation is the default; mock implementations can be injected
// for testing without touching engine logic.
//
// DB schema source of truth: ARCHITECTURE.md § 4 (appointments table).
// Date objects are the canonical internal format; ISO string conversion happens
// only at the Supabase API boundary (in this file).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Appointment, AppointmentStatus } from './types';

// ─── Interface ─────────────────────────────────────────────────────────────────

export interface IAppointmentRepository {
  /** Persist a new appointment row. Returns the created record. */
  create(appointment: Omit<Appointment, 'id' | 'createdAt'>): Promise<Appointment>;

  /** Retrieve a single appointment by primary key. */
  findById(id: string): Promise<Appointment | null>;

  /**
   * Find all non-cancelled, non-no_show appointments for a specialist that
   * overlap with the given UTC time range. Used for:
   *  - Double-booking guard in createAppointment
   *  - Slot availability calculation in getAvailableSlots (includes emergency_blocked)
   *
   * Overlap condition: existing.startsAt < toUtc AND existing.endsAt > fromUtc
   */
  findBySpecialistAndRange(
    clientId: string,
    specialistId: string,
    fromUtc: Date,
    toUtc: Date,
  ): Promise<readonly Appointment[]>;

  /** Update mutable fields on an existing appointment. Returns the updated record. */
  update(
    id: string,
    patch: Partial<Pick<Appointment, 'status' | 'googleEventId' | 'intakeId'>>,
  ): Promise<Appointment>;
}

// ─── Supabase row type (matches appointments table in ARCHITECTURE.md § 4) ─────

interface AppointmentRow {
  id: string;
  client_id: string;
  patient_id: string | null;         // nullable: null for emergency_blocked slots
  specialist_id: string;
  service_id: string;
  service_mode: string;
  starts_at: string;                 // TIMESTAMPTZ stored as ISO string
  ends_at: string;                   // TIMESTAMPTZ stored as ISO string
  status: AppointmentStatus;
  google_event_id: string | null;
  intake_id: string | null;
  created_at: string;                // TIMESTAMPTZ stored as ISO string
}

// ─── Mapping ───────────────────────────────────────────────────────────────────

function rowToAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    clientId: row.client_id,
    patientId: row.patient_id,
    specialistId: row.specialist_id,
    serviceId: row.service_id,
    serviceMode: row.service_mode as 'domicilio' | 'consultorio',
    startsAt: new Date(row.starts_at),  // ISO string → Date at boundary
    endsAt: new Date(row.ends_at),
    status: row.status,
    googleEventId: row.google_event_id,
    intakeId: row.intake_id,
    createdAt: new Date(row.created_at),
  };
}

function appointmentToRow(
  appt: Omit<Appointment, 'id' | 'createdAt'>,
): Omit<AppointmentRow, 'id' | 'created_at'> {
  return {
    client_id: appt.clientId,
    patient_id: appt.patientId,
    specialist_id: appt.specialistId,
    service_id: appt.serviceId,
    service_mode: appt.serviceMode,
    starts_at: appt.startsAt.toISOString(),  // Date → ISO string at boundary
    ends_at: appt.endsAt.toISOString(),
    status: appt.status,
    google_event_id: appt.googleEventId,
    intake_id: appt.intakeId,
  };
}

// ─── Supabase implementation ───────────────────────────────────────────────────

class SupabaseAppointmentRepository implements IAppointmentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(appointment: Omit<Appointment, 'id' | 'createdAt'>): Promise<Appointment> {
    const { data, error } = await this.supabase
      .from('appointments')
      .insert(appointmentToRow(appointment))
      .select()
      .single<AppointmentRow>();

    if (error) throw new Error(`appointmentRepository.create failed: ${error.message}`);
    if (!data) throw new Error('appointmentRepository.create returned no data');

    return rowToAppointment(data);
  }

  async findById(id: string): Promise<Appointment | null> {
    const { data, error } = await this.supabase
      .from('appointments')
      .select('*')
      .eq('id', id)
      .maybeSingle<AppointmentRow>();

    if (error) throw new Error(`appointmentRepository.findById failed: ${error.message}`);
    return data ? rowToAppointment(data) : null;
  }

  async findBySpecialistAndRange(
    clientId: string,
    specialistId: string,
    fromUtc: Date,
    toUtc: Date,
  ): Promise<readonly Appointment[]> {
    // True overlap query: existing.starts_at < toUtc AND existing.ends_at > fromUtc
    // This catches all cases: partial overlap, contained, and spanning intervals.
    // Excludes cancelled and no_show — all other statuses block the slot.
    const { data, error } = await this.supabase
      .from('appointments')
      .select('*')
      .eq('client_id', clientId)
      .eq('specialist_id', specialistId)
      .lt('starts_at', toUtc.toISOString())
      .gt('ends_at', fromUtc.toISOString())
      .not('status', 'in', '("cancelled","no_show")')
      .returns<AppointmentRow[]>();

    if (error) {
      throw new Error(`appointmentRepository.findBySpecialistAndRange failed: ${error.message}`);
    }

    return (data ?? []).map(rowToAppointment);
  }

  async update(
    id: string,
    patch: Partial<Pick<Appointment, 'status' | 'googleEventId' | 'intakeId'>>,
  ): Promise<Appointment> {
    const dbPatch: Partial<AppointmentRow> = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.googleEventId !== undefined) dbPatch.google_event_id = patch.googleEventId;
    if (patch.intakeId !== undefined) dbPatch.intake_id = patch.intakeId;

    const { data, error } = await this.supabase
      .from('appointments')
      .update(dbPatch)
      .eq('id', id)
      .select()
      .single<AppointmentRow>();

    if (error) throw new Error(`appointmentRepository.update failed: ${error.message}`);
    if (!data) throw new Error('appointmentRepository.update returned no data');

    return rowToAppointment(data);
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates an IAppointmentRepository backed by Supabase.
 *
 * @example
 * ```ts
 * const repo = createAppointmentRepository(supabase);
 * const appt = await repo.findById(id);
 * ```
 */
export function createAppointmentRepository(supabase: SupabaseClient): IAppointmentRepository {
  return new SupabaseAppointmentRepository(supabase);
}
