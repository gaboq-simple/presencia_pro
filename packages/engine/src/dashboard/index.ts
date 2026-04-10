// ─── Dashboard Module — Public API ────────────────────────────────────────────
// Components and types for the doctor's operational dashboard.
// All components are Client Components (interactive, receive pre-fetched data).
// Data fetching happens in the consuming Server Component (dashboard/page.tsx).

export { DayView } from './DayView';
export { AppointmentCard } from './AppointmentCard';
export type { AppointmentCardProps } from './AppointmentCard';
export { WeekView } from './WeekView';
export type { WeekViewProps } from './WeekView';
export { WeekNav } from './WeekNav';
export type { WeekNavProps } from './WeekNav';
export { IntakeViewer } from './IntakeViewer';
export { getPatientHistory, getMonthlyMetrics, getAnalyticsMetrics, getAtRiskPatients, getOccupancyHeatmap } from './queries';
export { generateAlerts } from './alerts';

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
  MonthlyMetrics,
  ServiceCount,
  AnalyticsMetrics,
  AlertData,
  AtRiskPatient,
} from './types';
