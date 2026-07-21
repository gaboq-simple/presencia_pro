// ─── Lifestyle Bot — Handler (Orquestador) ───────────────────────────────────
// Punto de entrada del motor conversacional de lifestyle.
// Recibe IncomingMessage + BusinessConfig, devuelve LifestyleBotResponse.
//
// Flujo:
//   1. Cargar o inicializar la conversación desde bot_conversations.
//   2. Validar el contexto con Zod (nunca asumir el JSONB).
//   3. Verificar horario de atención → si fuera: awayMessage sin procesar.
//   4. Verificar inactividad (> 24h) O estado terminal → reiniciar a GREETING.
//   5. Delegar al router según el estado actual.
//   6. Guardar el nuevo estado y contexto en bot_conversations.
//   7. Retornar LifestyleBotResponse con el mensaje al cliente.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LifestyleBotState } from '../../types/lifestyle.types';
import {
  deserializeContext,
  deserializeState,
  isTerminalState,
  serializeContext,
  shouldResetConversation,
} from './context';
import { dispatch } from './router';
import { tenantDb } from '../../tenantDb';
import { classifyIntent, classifyMultiIntent } from './classifier';
import { selectModel } from './modelRouter';
import { withRetry } from '../../utils/retry';
import { logBotError } from '../../utils/logger';
import type {
  LifestyleBusinessConfig,
  LifestyleIncomingMessage,
  OfficeHours,
  DaySchedule,
} from './types';
import { utcToLocalMinutes, utcToLocalDateStr } from './tzUtils';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type { LifestyleIncomingMessage, LifestyleBusinessConfig } from './types';

export type LifestyleBotResponse = {
  readonly message: string;
  /** AUD-05: true si el handler YA envió `message` vía `send` — el caller no debe re-enviarlo. */
  readonly sent?: boolean;
  /** AUD-05: true si `send` falló — el estado NO se persistió y no debe enviarse nada más. */
  readonly sendFailed?: boolean;
};

export type HandleLifestyleMessageOptions = {
  readonly msg: LifestyleIncomingMessage;
  readonly business: LifestyleBusinessConfig;
  readonly supabase: SupabaseClient;
  readonly anthropicKey: string;
  /**
   * AUD-05: envío de la respuesta al cliente, inyectado por el caller. Cuando
   * está presente, el handler envía ANTES de persistir el nuevo estado del FSM:
   * si el envío falla, el estado NO avanza — la conversación queda consistente
   * con lo que el cliente realmente vio (antes: el FSM quedaba esperando el
   * "sí" a una pregunta que nunca llegó, y el catch del route mandaba encima el
   * fallbackMessage "no te entendí" — pregunta fantasma + mensaje equivocado).
   * Sin `send` (tests, camino síncrono de Twilio dev), el comportamiento es el
   * histórico: persistir y devolver el texto al caller.
   */
  readonly send?: (text: string) => Promise<void>;
};

// ─── Tipo DB ──────────────────────────────────────────────────────────────────

type ConversationRow = {
  id: string;
  state: string;
  context: unknown;
  last_message: string;
  last_message_id: string | null;
};

// ─── Handler principal ────────────────────────────────────────────────────────

export async function handleLifestyleMessage(
  opts: HandleLifestyleMessageOptions,
): Promise<LifestyleBotResponse> {
  const { msg, business, supabase, anthropicKey, send } = opts;

  const startMs = Date.now();
  let errorInfo: { code: string; message: string } | null = null;

  // ── 1. Verificar horario de atención ─────────────────────────────────────

  if (!isWithinOfficeHours(business.officeHours, msg.timestamp, business.timezone)) {
    return { message: business.awayMessage };
  }

  // ── 2. Cargar conversación + deduplicación por message_id ────────────────
  // Si el message_id del mensaje entrante coincide con el último procesado,
  // es un reintento del webhook (Meta/Twilio) — retornar silenciosamente.
  // Documentación de la limitación en 017_message_id_dedup.sql.

  let row: ConversationRow | null = null;
  try {
    const { data: existingRow, error: selectError } = await tenantDb(supabase, msg.businessId)
      .table('bot_conversations')
      .select('id, state, context, last_message, last_message_id')
      .eq('customer_phone', msg.customerPhone)
      .maybeSingle();

    if (selectError) throw selectError;
    row = existingRow as ConversationRow | null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    errorInfo = { code: 'supabase_select_failed', message: errMsg };
    logBotError({
      ts:             new Date().toISOString(),
      service:        'bot',
      business_id:    msg.businessId,
      customer_phone: msg.customerPhone,
      state_from:     'UNKNOWN',
      state_to:       'GREETING',
      error_code:     'supabase_select_failed',
      error_message:  errMsg,
      recovered:      true,
    });
    // Tratar como conversación nueva — nunca explotar
  }

  // ── 2b. Deduplicación: si el message_id ya fue procesado, ignorar ─────────
  // Cubre reintentos del webhook de Meta/Twilio (el caso más frecuente de
  // mensajes duplicados). No cubre el race condition de doble-tap simultáneo —
  // para eso existe el constraint no_overlapping_appointments en appointments.

  if (msg.messageId && row?.last_message_id && row.last_message_id === msg.messageId) {
    // Mensaje ya procesado — retornar silenciosamente sin re-procesar
    return { message: '' };
  }

  // ── 3. Deserializar estado y contexto ─────────────────────────────────────

  let currentState: LifestyleBotState;
  let currentContext = deserializeContext(row?.context ?? {});

  if (row && (shouldResetConversation(new Date(row.last_message)) || isTerminalState(row.state))) {
    currentState   = 'GREETING';
    currentContext = {};
  } else {
    currentState = deserializeState(row?.state ?? 'GREETING');
  }

  // ── 4. Despachar al estado handler ────────────────────────────────────────

  const model = selectModel(currentState);

  const dispatchedResult = await dispatch(currentState, msg, currentContext, {
    business,
    supabase,
    anthropicKey,
    model,
    classifier: { classifyIntent, classifyMultiIntent },
  });

  // ── 4b. Acumular historial de conversación ────────────────────────────────
  // Máximo MAX_HISTORY_TURNS turnos (user+assistant por turno = 2 mensajes por turno).
  // Las transiciones silenciosas (responseText = '') no generan entradas — son
  // encadenamientos internos del FSM, no intercambios visibles con el usuario.
  // El reset por inactividad o estado terminal ya vacía currentContext = {}
  // antes de llegar aquí, por lo que el historial arranca limpio automáticamente.

  const MAX_HISTORY_TURNS = 6;

  const result = dispatchedResult.responseText
    ? {
        ...dispatchedResult,
        newContext: {
          ...dispatchedResult.newContext,
          messages: [
            ...(currentContext.messages ?? []),
            { role: 'user' as const, content: msg.body },
            { role: 'assistant' as const, content: dispatchedResult.responseText },
          ].slice(-(MAX_HISTORY_TURNS * 2)),
        },
      }
    : dispatchedResult;

  // ── 4c. Enviar ANTES de persistir (AUD-05) ────────────────────────────────
  // Con `send` inyectado, la respuesta viaja al cliente ANTES de avanzar el
  // FSM. Si el envío falla: NO se persiste (la conversación queda en el estado
  // que el cliente sí vio — sin pregunta fantasma), NO se manda nada más (un
  // fallback tras un send caído casi seguro también falla, y si llega, "no te
  // entendí" es el mensaje equivocado), y el fallo queda en logs + bot_logs.
  // El próximo mensaje del cliente re-corre desde el estado consistente; como
  // last_message_id tampoco se actualizó, un retry del webhook de Meta del
  // MISMO mensaje se reprocesa completo — segunda oportunidad de entrega.

  let sendFailed = false;
  if (send && result.responseText) {
    try {
      await send(result.responseText);
    } catch (err) {
      sendFailed = true;
      const errMsg = err instanceof Error ? err.message : String(err);
      errorInfo = { code: 'send_failed', message: errMsg };
      logBotError({
        ts:             new Date().toISOString(),
        service:        'bot',
        business_id:    msg.businessId,
        customer_phone: msg.customerPhone,
        state_from:     currentState,
        state_to:       result.newState,
        model_used:     model,
        error_code:     'send_failed',
        error_message:  errMsg,
        recovered:      false,
      });
    }
  }

  // ── 5. Persistir nuevo estado (solo si el cliente recibió la respuesta) ───

  if (!sendFailed) {
    const serializedContext = serializeContext(result.newContext);

    try {
      await withRetry(
        async () => {
          const { error } = await tenantDb(supabase, msg.businessId)
            .table('bot_conversations')
            .upsert(
              {
                customer_phone:  msg.customerPhone,
                state:           result.newState,
                context:         serializedContext,
                last_message:    msg.timestamp.toISOString(),
                last_message_id: msg.messageId ?? null,
              },
              { onConflict: 'business_id,customer_phone' },
            );
          if (error) throw error;
        },
        3,
        300,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errorInfo = { code: 'supabase_upsert_failed', message: errMsg };
      logBotError({
        ts:             new Date().toISOString(),
        service:        'bot',
        business_id:    msg.businessId,
        customer_phone: msg.customerPhone,
        state_from:     currentState,
        state_to:       result.newState,
        model_used:     model,
        error_code:     'supabase_upsert_failed',
        error_message:  errMsg,
        recovered:      true,
      });
      // Continuar — el mensaje ya se envió al usuario
    }
  }

  // ── 6. Escribir a bot_logs — best-effort ──────────────────────────────────

  const duration_ms = Date.now() - startMs;

  let eventType: string;
  if (errorInfo) {
    eventType = 'error_recovered';
  } else if (result.newState === 'ESCALATED') {
    eventType = 'escalated';
  } else if (result.newState === 'CONFIRMED') {
    eventType = 'appointment_created';
  } else {
    eventType = 'state_transition';
  }

  void (async () => {
    try {
      await withRetry(
        async () => {
          const { error } = await tenantDb(supabase, msg.businessId).table('bot_logs').insert({
            customer_phone: msg.customerPhone,
            state_from:     currentState,
            state_to:       result.newState,
            event_type:     eventType,
            model_used:     model,
            tokens_total:   null,
            error_code:     errorInfo?.code ?? null,
            error_message:  errorInfo?.message ?? null,
            recovered:      errorInfo ? true : null,
            duration_ms,
          });
          if (error) throw error;
        },
        2,
      );
    } catch (err) {
      logBotError({
        ts:             new Date().toISOString(),
        service:        'bot',
        business_id:    msg.businessId,
        customer_phone: msg.customerPhone,
        state_from:     currentState,
        state_to:       result.newState,
        model_used:     model,
        duration_ms,
        error_code:     'bot_logs_write_failed',
        error_message:  err instanceof Error ? err.message : String(err),
        recovered:      true,
      });
    }
  })();

  if (sendFailed) {
    return { message: '', sendFailed: true };
  }
  return send
    ? { message: result.responseText, sent: result.responseText.length > 0 }
    : { message: result.responseText };
}

// ─── Verificación de horario ──────────────────────────────────────────────────

/**
 * Retorna true si el timestamp está dentro del horario de atención del negocio.
 * Si officeHours es null, el bot atiende 24h.
 */
function isWithinOfficeHours(
  officeHours: OfficeHours | null,
  timestamp: Date,
  tz: string,
): boolean {
  if (officeHours === null) return true;

  // dayOfWeek y currentMinutes deben ser en el timezone del negocio
  const localDateStr    = utcToLocalDateStr(timestamp, tz);
  const dayKey          = String(new Date(localDateStr + 'T12:00:00Z').getDay());
  const daySchedule     = officeHours[dayKey] as DaySchedule | null | undefined;

  if (!daySchedule) return false;  // null = cerrado ese día

  const currentMinutes = utcToLocalMinutes(timestamp, tz);
  const startMinutes   = timeToMinutes(daySchedule.start);
  const endMinutes     = timeToMinutes(daySchedule.end);

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
