// ─── Lifestyle Bot — Internal Types ──────────────────────────────────────────
// Tipos internos del motor conversacional de lifestyle.
// No se re-exportan desde el index del engine — son privados a este módulo.

import type { LifestyleBotContext, LifestyleBotState } from '../../types/lifestyle.types';

// ─── Incoming message ─────────────────────────────────────────────────────────

export type LifestyleIncomingMessage = {
  /** business_id resuelto desde whatsapp_phone_number_id — siempre del servidor. */
  readonly businessId: string;
  /** whatsapp_id canónico del cliente: solo dígitos, sin + ni espacios. */
  readonly customerPhone: string;
  /** Nombre del perfil de WhatsApp del cliente — null si no viene en el payload. */
  readonly customerName: string | null;
  readonly body: string;
  readonly timestamp: Date;
  /**
   * ID único del mensaje asignado por el proveedor.
   * Meta:   wamid.xxx (campo message.id del payload).
   * Twilio: MessageSid del form-data.
   * Usado para deduplicar reintentos del webhook (migración 017_message_id_dedup).
   * null si el adapter no lo proporciona.
   */
  readonly messageId: string | null;
};

// ─── Business config ──────────────────────────────────────────────────────────
// Fila de la tabla businesses con los campos que necesita el bot.

export type DaySchedule = {
  readonly start: string;  // "HH:MM" en timezone del negocio
  readonly end: string;    // "HH:MM" en timezone del negocio
};

/** office_hours JSONB: clave = "0"–"6" (día semana). null = cerrado ese día. */
export type OfficeHours = Partial<Record<string, DaySchedule | null>>;

export type LifestyleBusinessConfig = {
  readonly id: string;
  readonly name: string;
  readonly whatsappNumber: string;
  readonly whatsappPhoneNumberId: string;
  readonly botName: string;
  readonly awayMessage: string;
  readonly fallbackMessage: string;
  readonly officeHours: OfficeHours | null;
  readonly walkInBufferMinutes: number;
  readonly address: string;
  /** IANA timezone del negocio. Ej: 'America/Mexico_City'. */
  readonly timezone: string;
};

// ─── Catalog rows ─────────────────────────────────────────────────────────────

export type ServiceRow = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly duration_minutes: number;
  readonly price: number;
  readonly currency: string;
};

export type StaffRow = {
  readonly id: string;
  readonly name: string;
  readonly whatsapp_id: string;
};

export type StaffAvailabilityRow = {
  readonly staff_id: string;
  readonly day_of_week: number;
  readonly start_time: string;  // "HH:MM:SS"
  readonly end_time: string;    // "HH:MM:SS"
};

// ─── Scheduling ───────────────────────────────────────────────────────────────

export type SlotCandidate = {
  readonly staffId: string;
  readonly staffName: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
};

// ─── State handler contract ───────────────────────────────────────────────────

export type StateHandlerResult = {
  readonly newState: LifestyleBotState;
  readonly newContext: LifestyleBotContext;
  readonly responseText: string;
};

export type StateHandlerDeps = {
  readonly business: LifestyleBusinessConfig;
  readonly supabase: import('@supabase/supabase-js').SupabaseClient;
  readonly anthropicKey: string;
  /** Model ID pre-seleccionado por modelRouter.selectModel() — los state handlers lo consumen sin decidirlo. */
  readonly model: string;
};
