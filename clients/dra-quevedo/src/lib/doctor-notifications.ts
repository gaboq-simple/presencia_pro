// ─── Doctor notifications ─────────────────────────────────────────────────────
// Constructores de mensajes WhatsApp para el especialista.
// Sin strings de negocio hardcodeados — todo viene de appointment y config.

import type { Appointment } from '@presenciapro/engine/scheduling';
import type { ClientConfig } from '@presenciapro/engine/types';

// ─── Internal ─────────────────────────────────────────────────────────────────

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    hour:    '2-digit',
    minute:  '2-digit',
  }).format(date);
}

function resolveServiceName(appointment: Appointment, config: ClientConfig): string {
  return config.services.find((s) => s.id === appointment.serviceId)?.name
    ?? appointment.serviceId;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

/** Nueva cita agendada — enviado desde bot al crear la cita. */
export function buildNewAppointmentNotification(
  appointment: Appointment,
  patientPhone: string,
  config: ClientConfig,
): string {
  const modo  = appointment.serviceMode === 'domicilio' ? 'a domicilio' : 'en consultorio';
  const fecha = formatDate(appointment.startsAt, config.client.timezone);
  return (
    `📅 Nueva cita agendada\n\n` +
    `Paciente: +${patientPhone}\n` +
    `Servicio: ${resolveServiceName(appointment, config)}\n` +
    `Modalidad: ${modo}\n` +
    `Fecha: ${fecha}`
  );
}

/** Cita confirmada — enviado desde api/appointments/confirm. */
export function buildConfirmedAppointmentNotification(
  appointment: Appointment,
  patientPhone: string,
  config: ClientConfig,
): string {
  const fecha = formatDate(appointment.startsAt, config.client.timezone);
  return (
    `✅ Cita confirmada\n\n` +
    `Paciente: +${patientPhone}\n` +
    `Servicio: ${resolveServiceName(appointment, config)}\n` +
    `Fecha: ${fecha}`
  );
}

/** Cita cancelada — enviado desde api/appointments/cancel. */
export function buildCancelledAppointmentNotification(
  appointment: Appointment,
  patientPhone: string,
  reason: string | undefined,
  config: ClientConfig,
): string {
  const fecha = formatDate(appointment.startsAt, config.client.timezone);
  return (
    `❌ Cita cancelada\n\n` +
    `Paciente: +${patientPhone}\n` +
    `Servicio: ${resolveServiceName(appointment, config)}\n` +
    `Fecha: ${fecha}\n` +
    `Razón: ${reason ?? 'no especificada'}`
  );
}

/** Cita completada — enviado desde api/appointments/complete. */
export function buildCompletedAppointmentNotification(
  appointment: Appointment,
  patientPhone: string,
  config: ClientConfig,
): string {
  const fecha = formatDate(appointment.startsAt, config.client.timezone);
  return (
    `✔️ Cita completada\n\n` +
    `Paciente: +${patientPhone}\n` +
    `Servicio: ${resolveServiceName(appointment, config)}\n` +
    `Fecha: ${fecha}`
  );
}

/** No show — enviado desde api/appointments/no-show. */
export function buildNoShowNotification(
  appointment: Appointment,
  patientPhone: string,
  config: ClientConfig,
): string {
  const fecha = formatDate(appointment.startsAt, config.client.timezone);
  return (
    `⚠️ No show\n\n` +
    `Paciente: +${patientPhone}\n` +
    `Servicio: ${resolveServiceName(appointment, config)}\n` +
    `Fecha: ${fecha}`
  );
}
