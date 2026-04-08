// ─── Bot Module — Contract Types ─────────────────────────────────────────────
// Estos tipos definen la interfaz pública del módulo bot.
// El engine nunca contiene datos de cliente — recibe ClientConfig en runtime.

// ─── Types imported from scheduling/ ──────────────────────────────────────────
// TimeSlot y Appointment viven en scheduling/ — se re-exportan desde aquí
// para que los consumidores del bot no necesiten importar desde dos módulos.

export type { TimeSlot, Appointment } from '../scheduling';

// ─── Bot-specific appointment request ─────────────────────────────────────────
// AppointmentRequest se define aquí, NO se importa de scheduling/, porque el
// bot solo conoce el número de teléfono del paciente (IncomingMessage.from).
// El UUID patientId lo resuelve el webhook handler:
//   patientPhone → lookup/upsert en tabla patients → patientId UUID →
//   scheduling.AppointmentRequest → scheduling.createAppointment()

export type AppointmentRequest = {
  readonly clientId: string
  readonly patientPhone: string    // el bot conoce el teléfono, no el UUID
  readonly specialistId: string
  readonly serviceId: string
  readonly serviceMode: 'domicilio' | 'consultorio'
  readonly startsAt: Date          // Date object — conversión a ISO en el webhook handler
}

// ─── Incoming message ─────────────────────────────────────────────────────────

export type IncomingMessage = {
  readonly from: string           // número WhatsApp del paciente — ej: "5215558056215"
  readonly body: string           // texto del mensaje recibido
  readonly clientId: string       // para cargar config del cliente correcto
  readonly timestamp: Date
}

// ─── Bot response ─────────────────────────────────────────────────────────────

export type BotResponse = {
  readonly message: string        // texto a enviar al paciente
  readonly action?: BotAction     // acción opcional a ejecutar
}

export type BotAction =
  | { readonly type: 'CREATE_APPOINTMENT'; readonly data: AppointmentRequest }
  | { readonly type: 'SEND_INTAKE_LINK'; readonly appointmentId: string }
  | { readonly type: 'ESCALATE_TO_HUMAN'; readonly reason: string }
  | { readonly type: 'SEND_LOCATION'; readonly specialistId: string }
  | { readonly type: 'CONFIRM_APPOINTMENT'; readonly appointmentId: string }
  | { readonly type: 'CANCEL_APPOINTMENT'; readonly appointmentId: string; readonly reason?: string }

// ─── Conversation step ────────────────────────────────────────────────────────

export type ConversationStep =
  | 'GREETING'
  | 'QUALIFYING_VISIT_TYPE'    // ¿primera vez o seguimiento?
  | 'QUALIFYING_SERVICE'       // ¿qué servicio te interesa?
  | 'QUALIFYING_MODE'          // ¿domicilio o consultorio?
  | 'SHOWING_SLOTS'            // mostrando horarios disponibles
  | 'CONFIRMING_APPOINTMENT'   // esperando confirmación del slot elegido
  | 'AWAITING_CONFIRMATION'    // cita en pending_confirmation — esperando SÍ/NO del paciente
  | 'SENDING_INTAKE'           // enviando link de formulario
  | 'AWAITING_INTAKE'          // esperando que llene el formulario
  | 'COMPLETED'                // cita confirmada y formulario enviado
  | 'AWAY'                     // fuera de horario
  | 'ESCALATED'                // escalado a humano

// ─── Conversation context ─────────────────────────────────────────────────────

export type ConversationContext = {
  readonly specialistId?: string
  readonly serviceId?: string
  readonly serviceMode?: 'domicilio' | 'consultorio'
  readonly selectedSlot?: string          // ISO 8601 del slot elegido
  readonly appointmentId?: string
  readonly followUpScheduled?: boolean
  readonly confirmationRetries?: number   // veces que el paciente respondió algo distinto a SÍ/NO
  readonly messages?: ReadonlyArray<ConversationMessage>  // historial para Claude
}

export type ConversationMessage = {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

// ─── Conversation state ───────────────────────────────────────────────────────
// Persiste en Supabase tabla bot_conversations.

export type ConversationState = {
  readonly id: string
  readonly clientId: string
  readonly patientPhone: string
  readonly state: ConversationStep
  readonly context: ConversationContext
  readonly lastMessage: Date
}
