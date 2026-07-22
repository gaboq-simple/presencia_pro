import { z } from 'zod';

// ─── Lifestyle Bot States ─────────────────────────────────────────────────────
// Flujo canónico:
//   GREETING → QUALIFYING_SERVICE → [QUALIFYING_STAFF] → QUALIFYING_DATETIME
//   → SHOWING_SLOTS → CONFIRMING_APPOINTMENT → AWAITING_CONFIRMATION
//   → CONFIRMED → (conversación completa)
//
// QUALIFYING_STAFF solo aplica cuando el negocio tiene más de un staff activo
// que ofrece el servicio solicitado.
//
// FALLBACK: estado transitorio para input no reconocido. Después de
// fallbackAttempts >= 2 transiciona a ESCALATED.
//
// CONFIRMED vs COMPLETED:
//   CONFIRMED  = cita agendada por el bot, flujo conversacional terminado.
//   COMPLETED  = visita realizada (estado de ciclo de vida post-visita).

export const LifestyleBotStateSchema = z.enum([
  'GREETING',
  'QUALIFYING_SERVICE',           // ¿qué servicio te interesa?
  'QUALIFYING_STAFF',             // ¿con quién quieres? (multi-staff)
  'QUALIFYING_DATETIME',          // ¿qué día y turno prefieres?
  'SHOWING_SLOTS',                // mostrando horarios disponibles (≤3 opciones)
  'QUALIFYING_WAITLIST',          // ¿quieres lista de espera? (cuando no hay slots disponibles)
  'CONFIRMING_APPOINTMENT',       // cliente elige opción 1/2/3
  'AWAITING_CONFIRMATION',        // bot resume detalles — esperando SÍ/NO del cliente (legacy)
  'AWAITING_BOOKING_NAME',        // bot pregunta a nombre de quién va la cita
  'CONFIRMED',                    // cita creada, barbero notificado, recordatorio programado
  'AWAITING_CANCEL_CONFIRMATION', // cliente expresó intención de cancelar
  'COMPLETED',                    // visita realizada (post-visita — no usado por el bot)
  'FALLBACK',                     // input no reconocido — responde con fallbackMessage
  'AWAY',                         // fuera de horario de atención
  'ESCALATED',                    // escalado a humano (tras 2 intentos fallidos en FALLBACK)
]);

export type LifestyleBotState = z.infer<typeof LifestyleBotStateSchema>;

// ─── Conversation Messages ────────────────────────────────────────────────────

const LifestyleConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export type LifestyleConversationMessage = z.infer<
  typeof LifestyleConversationMessageSchema
>;

// ─── Pending Slot ─────────────────────────────────────────────────────────────
// Representa una opción de cita presentada al cliente (opciones 1/2/3).
// Persiste en el contexto para mapear la elección del cliente al slot real.

export const LifestylePendingSlotSchema = z.object({
  /** Número de opción mostrado al cliente (1, 2 o 3). */
  index: z.number().int().min(1).max(3),
  staffId: z.string().uuid(),
  staffName: z.string(),
  /** ISO 8601 UTC — inicio del slot. */
  startsAt: z.string().datetime(),
  /** ISO 8601 UTC — fin del slot (startsAt + service.duration_minutes). */
  endsAt: z.string().datetime(),
});

export type LifestylePendingSlot = z.infer<typeof LifestylePendingSlotSchema>;

// ─── Lifestyle Bot Context ────────────────────────────────────────────────────
// Persiste en bot_conversations.context (JSONB).
// Deserializar con LifestyleBotContextSchema.safeParse() al leer de la DB.
// Nunca asumir que el JSONB tiene la forma correcta — siempre validar.

export const LifestyleBotContextSchema = z.object({
  // ── Selecciones del cliente ───────────────────────────────────────────────

  /** UUID del servicio elegido — coincide con services.id en la DB. */
  serviceId: z.string().uuid().optional(),

  /** UUID del staff elegido — coincide con staff.id en la DB. */
  staffId: z.string().uuid().optional(),

  /**
   * Verdad-de-terreno de la INTENCIÓN de barbero del cliente (S5-BOT-10).
   * Distinto de staffId (sobrecargado: pick + objetivo de query, lo borra el
   * fallback de auto-assign). requestedStaffId vive y muere con serviceId/staffId:
   * se setea cuando el cliente elige barbero explícitamente y se limpia SOLO vía
   * clearBookingSelection() (corrección de servicio / reset / auto-assign).
   * Usado por buildConfirmationResult como guarda del cierre defensivo: nunca
   * cerrar con un barbero distinto al solicitado sin aceptación explícita.
   */
  requestedStaffId: z.string().uuid().optional(),

  /**
   * true si el cliente no especificó barbero ("cualquiera" / "no importa").
   * El estado SHOWING_SLOTS usa round-robin ponderado cuando autoAssign=true.
   */
  autoAssign: z.boolean().optional(),

  // ── Fecha y turno ─────────────────────────────────────────────────────────

  /**
   * Fecha solicitada por el cliente en formato YYYY-MM-DD (timezone local del negocio).
   * Se establece en QUALIFYING_DATETIME y se usa en SHOWING_SLOTS para buscar disponibilidad.
   */
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  /**
   * Turno preferido expresado por el cliente.
   * morning  = mañana (hasta 12:59)
   * afternoon = tarde (13:00 en adelante)
   * null cuando el cliente no expresó preferencia de turno.
   */
  requestedShift: z.enum(['morning', 'afternoon']).nullable().optional(),

  /** true si el cliente activó modo walk-in ("ahorita", "ahora", "ya", etc.). */
  isWalkIn: z.boolean().optional(),

  /**
   * Hora específica solicitada por el cliente en formato "HH:MM".
   * Se establece en GREETING cuando el clasificador detecta hora con confidence ≥ 0.80
   * y el value se puede parsear a hora concreta (ej: "a las 5" → "17:00").
   * null si el cliente no especificó hora exacta (solo shift morning/afternoon).
   */
  requestedTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),

  /**
   * @deprecated (FIX 2 / disponibilidad honesta) — superado por `pendingAgendaTime`.
   * Ya no se ESCRIBE: la hora ambigua se resuelve contra la agenda real, no se
   * pregunta el período de entrada. El campo se conserva en el schema solo por
   * COMPATIBILIDAD con conversaciones en vuelo al momento del deploy (el bloque
   * resolvedor en qualifyingDatetime.ts las cierra). DEUDA: borrar el campo + su
   * resolvedor en una limpieza futura (semanas post-deploy, sin conversaciones en
   * vuelo). Como el `?? parseViejo()`: deuda consciente con fecha de cobro.
   *
   * Antes: hora ambigua aparcada esperando que el cliente aclare el período (R2 C2.1).
   */
  pendingPeriodTime: z
    .object({
      hour:   z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    })
    .nullable()
    .optional(),

  /**
   * Hora ambigua APARCADA cruda para resolver contra la AGENDA real (FIX 2 /
   * disponibilidad honesta). A diferencia de `pendingPeriodTime` (que PREGUNTABA el
   * período), esta NO molesta al cliente: se setea cuando `resolveInterpretedTime`
   * devuelve kind:'defer-agenda' (hora 1–11 EN PUNTO sin marcador am/pm — "a las 8"
   * = 8am ó 8pm) y se resuelve sola en `handleHonestAvailability` vía
   * `resolveTargetMinutes(raw, shape.all)`: el barbero+fecha ya están, así que la
   * agenda decide el AM/PM por el slot real más cercano. Último recurso (sin agenda
   * alcanzable): se pregunta "¿de la mañana o de la noche?". Se limpia al resolverse
   * o en cualquier reset de reserva. null/ausente si no hay hora pendiente.
   */
  pendingAgendaTime: z
    .object({
      hour:   z.number().int().min(1).max(11),
      minute: z.number().int().min(0).max(59),
    })
    .nullable()
    .optional(),

  // ── Slots presentados ─────────────────────────────────────────────────────

  /**
   * Las ≤3 opciones de cita presentadas al cliente en SHOWING_SLOTS.
   * Persiste para que CONFIRMING_APPOINTMENT pueda mapear "1" → slot real.
   * Se limpia al confirmar o reiniciar el flujo.
   */
  pendingSlots: z.array(LifestylePendingSlotSchema).optional(),

  /**
   * Eje de presentación de slots (S5-BOT-04).
   * 'time' (o ausente) = comportamiento por defecto: en autoAssign se deduplica
   *   por hora y se ocultan los nombres de barbero.
   * 'staff' = el cliente quiere elegir/saber el barbero → presentar POR barbero
   *   (sin deduplicar por hora, mostrando el nombre de cada uno).
   */
  presentBy: z.enum(['time', 'staff']).optional(),

  /**
   * Disponibilidad honesta: el bot acaba de preguntar la franja binaria
   * ("¿mañana o más tarde?") porque hay slots en AMBAS franjas. El siguiente turno
   * se parsea LOCALMENTE como franja (parseFranjaReply) — NO como fecha: "mañana"
   * aquí significa franja-mañana, no día-siguiente. true mientras esté pendiente.
   */
  pendingFranjaChoice: z.boolean().optional(),

  // ── Slot elegido y cita ───────────────────────────────────────────────────

  /** Slot elegido en ISO 8601 UTC. Se establece en CONFIRMING_APPOINTMENT. */
  selectedSlot: z.string().datetime().optional(),

  /**
   * Slot más cercano ofrecido cuando el cliente pidió una hora NO disponible
   * en CONFIRMING_APPOINTMENT (decisión b: "a las 6 no tengo, lo más cercano es 5:15").
   * ISO 8601 UTC del pendingSlot ofrecido. Si el cliente responde afirmativamente
   * en el siguiente turno, se selecciona ese slot. null/ausente si no hay oferta pendiente.
   */
  nearestOfferSlot: z.string().datetime().nullable().optional(),

  /**
   * Desambiguación pendiente del dígito pelado ambiguo (S5-BOT-07).
   * Se setea cuando un dígito es índice válido [1..N] PERO su lectura como hora
   * cae cerca (no exacta) de un slot ofrecido (EXACT_TOL < dist ≤ NEAR_TOL): el
   * bot preguntó "¿te refieres a la X?". El siguiente turno lo resuelve:
   * "sí" → la HORA (requestedMinutes), "no" → el ÍNDICE (indexChoice).
   * Exclusión mutua con nearestOfferSlot: nunca ambas activas a la vez.
   * null/ausente si no hay desambiguación pendiente.
   */
  pendingDigitDisambig: z
    .object({
      requestedMinutes: z.number().int().nonnegative(),
      indexChoice:      z.number().int().min(1),
    })
    .nullable()
    .optional(),

  /** UUID de la cita creada en la DB — se establece en CONFIRMED. */
  appointmentId: z.string().uuid().optional(),

  // ── Nombre de la cita ─────────────────────────────────────────────────────

  /**
   * Nombre real para la cita, confirmado por el cliente en AWAITING_BOOKING_NAME.
   * Puede diferir de customers.name (quien agendó por WhatsApp).
   * Se guarda en appointments.booking_name al crear la cita.
   */
  bookingName: z.string().optional(),

  /**
   * Nombre pre-llenado desde el perfil de WhatsApp, pendiente de confirmación.
   * Solo se establece cuando isLikelyRealName(customerName) === true.
   * Se limpia al confirmar o rechazar el nombre.
   */
  pendingBookingName: z.string().nullable().optional(),

  // ── Cliente resuelto ──────────────────────────────────────────────────────

  /**
   * UUID del customer resuelto en GREETING (RETURNING_CHECK).
   * Necesario en CONFIRMED para actualizar favorite_staff_id / favorite_service_id.
   */
  customerId: z.string().uuid().optional(),

  // ── Seguimiento ───────────────────────────────────────────────────────────

  /** true si ya se agendó un recordatorio 1h para esta cita. */
  followUpScheduled: z.boolean().optional(),

  /**
   * Veces que el cliente respondió algo distinto a SÍ/NO en AWAITING_CONFIRMATION.
   * Usado para escalar tras 2 intentos.
   */
  confirmationRetries: z.number().int().nonnegative().optional(),

  /**
   * Contador de mensajes no reconocidos en FALLBACK.
   * Al llegar a 2, el estado transiciona a ESCALATED.
   */
  fallbackAttempts: z.number().int().nonnegative().optional(),

  /** UUID de la cita cuya cancelación está pendiente de confirmación. */
  pendingCancelAppointmentId: z.string().uuid().optional(),

  /**
   * Qué pidió el cliente sobre esa cita (AUD-02): 'cancellation' = cancelarla;
   * 'modification' = moverla (tras cancelar, pre-llena servicio/barbero y pasa
   * a QUALIFYING_DATETIME para reagendar sin re-preguntar lo conocido).
   */
  pendingCancelType: z.enum(['cancellation', 'modification']).optional(),

  /**
   * AUD-04: día LOCAL (YYYY-MM-DD, tz del negocio) de la cita pendiente de
   * cancelar/mover. Permite detectar "no, la del viernes" (día distinto →
   * re-apuntar a esa otra cita) sin re-consultar la BD.
   */
  pendingCancelDay: z.string().optional(),

  /**
   * AUD-03: true cuando el aviso al admin de ESTA escalada ya se disparó.
   * Lo setea dispatch() al detectar la transición a ESCALATED — dedup para que
   * los mensajes siguientes del cliente (ESCALATED pegajoso) no re-notifiquen.
   */
  escalation_notified: z.boolean().optional(),

  /**
   * AUD-03: mensajes del cliente sostenidos en ESCALATED pegajoso. El 1º recibe
   * "el equipo ya está enterado"; a partir del 2º sin respuesta humana, el bot
   * retoma la atención (vía GREETING) para no dejar al cliente colgado.
   */
  escalation_holds: z.number().int().nonnegative().optional(),

  /**
   * AUD-07a: true cuando ya se antepuso el aviso de fuera-de-horario en este
   * periodo cerrado. El handler lo fuerza mientras el negocio está cerrado y
   * lo limpia al reabrir — el siguiente periodo cerrado vuelve a avisar una vez.
   */
  away_notice_sent: z.boolean().optional(),

  /**
   * AUD-07b: throws de handler consecutivos (fallo técnico, no incomprensión).
   * Se resetea a 0 en el primer turno exitoso; al llegar a MAX_TECH_FAILURES
   * el dispatch escala a humano con la verdad ("problemas técnicos").
   */
  tech_failures: z.number().int().nonnegative().optional(),

  /**
   * AUD-07f: últimos message_ids procesados (ventana de 5). El dedup por
   * last_message_id solo cubría el reintento del ÚLTIMO mensaje — un retry
   * fuera de orden del webhook (mensaje N-1 llegando después del N) se
   * reprocesaba y pisaba el estado del flujo.
   */
  recent_message_ids: z.array(z.string()).optional(),

  // ── Clasificador de intenciones ───────────────────────────────────────────

  /**
   * Número de intentos de clarificación en el estado actual.
   * Se resetea a 0 cuando el estado avanza.
   * Al llegar a 2, fuerza REPEAT_OPTIONS sin importar la confianza.
   */
  clarification_attempts: z.number().int().nonnegative().optional(),

  /**
   * Número de "no" CONSECUTIVOS del cliente en CONFIRMING_APPOINTMENT.
   * Separado de clarification_attempts: distingue "me dijiste que no" (rechazo)
   * de "no te entendí" (input no reconocido). Se resetea a 0 ante cualquier
   * avance (selección o corrección exitosa). Progresión escalonada de rechazo:
   * 0→re-ofrecer alternativas, 1→preguntar hora abierta, 2→cambiar de eje,
   * 3→handoff a humano (ESCALATED).
   */
  rejection_attempts: z.number().int().nonnegative().optional(),

  /**
   * Contador de escape ESTRUCTURAL: turnos consecutivos SIN progreso real
   * dentro del flujo de agendamiento. A diferencia de clarification_attempts /
   * rejection_attempts, ninguna rama de clarify puede resetearlo — lo calcula
   * el wrapper de dispatch() por delta de estado/contexto, no la cooperación de
   * los handlers. Se incrementa por defecto y solo se resetea ante progreso real
   * (avance de estado en el orden canónico o un campo de la reserva recién
   * llenado). Al alcanzar STRUCTURAL_CAP, dispatch() fuerza ESCALATED.
   */
  no_progress_streak: z.number().int().nonnegative().optional(),

  /**
   * Última side question del cliente (texto tal cual), o null si no hubo.
   * Se resetea a null cuando el estado avanza.
   */
  last_side_question: z.string().nullable().optional(),

  // ── Historial de mensajes para Claude API ─────────────────────────────────

  /** Historial de mensajes para el contexto de Claude API. */
  messages: z.array(LifestyleConversationMessageSchema).optional(),

  /**
   * IDs de servicios candidatos cuando el input del cliente es ambiguo
   * (ej: "corte" matchea "Corte clásico" Y "Corte + barba").
   * Se limpia cuando el cliente elige un servicio concreto.
   */
  ambiguous_service_candidates: z.array(z.string()).optional(),
});

export type LifestyleBotContext = z.infer<typeof LifestyleBotContextSchema>;

// ─── Appointment Status ───────────────────────────────────────────────────────
// Espejo del CHECK constraint en appointments.status en la DB.

export const AppointmentStatusSchema = z.enum([
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'walkin',
]);

export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

// ─── Appointment Source ───────────────────────────────────────────────────────

export const AppointmentSourceSchema = z.enum(['bot', 'manual', 'walkin']);

export type AppointmentSource = z.infer<typeof AppointmentSourceSchema>;

// ─── Staff Role ───────────────────────────────────────────────────────────────
// Espejo del CHECK constraint en staff.role en la DB.

export const StaffRoleSchema = z.enum(['admin', 'barber', 'assistant']);

export type StaffRole = z.infer<typeof StaffRoleSchema>;
