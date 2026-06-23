// ─── Lifestyle Bot — Internal Types ──────────────────────────────────────────
// Tipos internos del motor conversacional de lifestyle.
// No se re-exportan desde el index del engine — son privados a este módulo.

import type { LifestyleBotContext, LifestyleBotState } from '../../types/lifestyle.types';
// `import type` (erased en runtime) evita un ciclo: interpreter.ts importa valores
// de states/qualifyingDatetime, que a su vez importa de aquí.
import type { Interpretation } from './interpreter';

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
  /** Tipo de negocio (ej: 'barbería', 'salón de belleza'). Usado en el system prompt.
   * TODO: poblar desde businesses.business_type en todos los tenants. */
  readonly businessType?: string;
  /** slug del minisite (/[slug]). Usado para construir el link [DERIVA]. */
  readonly slug?: string;
  /** URL de reseñas (Google Reviews u otra). NULL/undefined si no configurado. */
  readonly reviewUrl?: string | null;
  /** Link de mapa (Google/Apple Maps) para ubicación. NULL/undefined si no configurado. */
  readonly mapUrl?: string | null;
  /** Amenities/banderas del negocio (pays_card, parking, kids_friendly, …). Default {}. */
  readonly attributes?: Record<string, boolean> | null;
};

// ─── Catalog rows ─────────────────────────────────────────────────────────────

export type ServiceRow = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly duration_minutes: number;
  readonly price: number;
  readonly currency: string;
  /** Precio mínimo aproximado (migración 039). NULL = usar `price` exacto. */
  readonly price_min?: number | null;
  /** Precio máximo del rango (migración 039). Requiere price_min. */
  readonly price_max?: number | null;
  /** Nota libre del precio ("aprox", "según largo", …) (migración 039). */
  readonly price_note?: string | null;
};

export type StaffRow = {
  readonly id: string;
  readonly name: string;
  readonly whatsapp_id: string;
};

export type StaffAvailabilityRow = {
  readonly staff_id: string;
  readonly day_of_week: number;
  readonly start_time: string;         // "HH:MM:SS"
  readonly end_time: string;           // "HH:MM:SS"
  readonly break_start: string | null; // "HH:MM:SS" | null
  readonly break_end: string | null;   // "HH:MM:SS" | null
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

/**
 * Clasificadores inyectables (R1 — Pieza A).
 * Producción inyecta la implementación real (`./classifier`); los tests inyectan
 * un mock determinista sin red. NO se cambia la firma de los clasificadores —
 * solo QUIÉN los provee. Mata el acoplamiento handler↔classifier que impedía el
 * e2e del happy-path.
 */
export type ClassifierFns = {
  readonly classifyIntent:      typeof import('./classifier').classifyIntent;
  readonly classifyMultiIntent: typeof import('./classifier').classifyMultiIntent;
};

/** Re-export del tipo de resultado multi-intent para que los handlers no
 * importen directamente de './classifier' (preserva la frontera de inyección). */
export type { MultiIntentClassification } from './classifier';

export type StateHandlerDeps = {
  readonly business: LifestyleBusinessConfig;
  readonly supabase: import('@supabase/supabase-js').SupabaseClient;
  readonly anthropicKey: string;
  /** Model ID pre-seleccionado por modelRouter.selectModel() — los state handlers lo consumen sin decidirlo. */
  readonly model: string;
  /** Clasificadores inyectables. Producción = impl real; tests = mock sin red. */
  readonly classifier: ClassifierFns;
  /**
   * Interpretación CRUDA del turno (R2 — intérprete de turno único). La inyecta
   * `dispatch()` una sola vez por turno, antes del switch de estado. Opcional a
   * nivel de tipo para que los call-sites que construyen deps a mano (tests de
   * handler directo) sigan compilando; en el flujo real SIEMPRE está presente.
   * En R2 ningún handler la consume todavía (Pieza B = solo cablear; los
   * consumidores llegan en Pieza C). Inmutable.
   */
  readonly interpretation?: Interpretation;
};
