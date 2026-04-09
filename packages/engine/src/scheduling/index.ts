// ─── Scheduling Module — Public API ────────────────────────────────────────────
// This is the only entry point for @presenciapro/engine/scheduling.
// Nothing that isn't exported here exists for modules outside this package.

export { getAvailableSlots } from './slots';

export {
  createAppointment,
  cancelAppointment,
  confirmAppointment,
  completeAppointment,
  getAppointment,
  getAppointmentsForDay,
} from './appointments';

export { blockEmergencySlots, isEmergencySlot, releaseEmergencySlot } from './emergency';

export type {
  TimeSlot,
  AppointmentRequest,
  Appointment,
  AppointmentStatus,
  AppointmentDeps,
  EmergencyDeps,
  GetAvailableSlotsParams,
  CancelAppointmentParams,
  GoogleCredentials,
  BusyPeriod,
  OfficeHours,
  SlotConfig,
} from './types';

export { SlotUnavailableError } from './types';

export { createAppointmentRepository } from './appointmentRepository';
export type { IAppointmentRepository } from './appointmentRepository';

export { blockDay, unblockDay } from './blockedDays';
export type { BlockDayParams, UnblockDayParams } from './blockedDays';

export { generateCancelToken, generateCancelUrl, verifyCancelToken } from './cancelTokens';
export type { CancelToken } from './cancelTokens';
