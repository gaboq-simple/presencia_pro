// ─── Dashboard Module — Public API ────────────────────────────────────────────
// Components and types for the doctor's operational dashboard.
// All components are Client Components (interactive, receive pre-fetched data).
// Data fetching happens in the consuming Server Component (dashboard/page.tsx).

export { DayView } from './DayView.js';
export { IntakeViewer } from './IntakeViewer.js';
export { getPatientHistory } from './queries.js';

export type {
  AppointmentWithPatient,
  EmergencySlot,
  IntakeData,
  IntakeField,
  AppointmentStatus,
  Appointment,
  PatientHistory,
  PatientHistorySummary,
  PatientHistoryAppointment,
} from './types.js';
