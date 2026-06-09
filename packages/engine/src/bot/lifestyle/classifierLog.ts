// ─── Lifestyle Bot — Classifier Output Logging (S5-OBS-01) ───────────────────
// Persiste el output de los clasificadores en bot_logs (event_type='classifier_output').
//
// Objetivo: convertir el diagnóstico del clasificador de inferencia en lectura
// directa, SIN alterar ningún comportamiento observable del bot.
//
// Reusa el mismo mecanismo de escritura que handler.ts (supabase.from('bot_logs')
// .insert + withRetry + logBotError en fallo). NO crea cliente nuevo.
//
// Fire-and-forget: logClassifierOutput() retorna void de inmediato; la escritura
// corre en una promesa no-await-eada. Si falla, solo se registra vía logBotError
// y NUNCA se propaga a la respuesta del usuario.
//
// El payload va en la columna metadata (jsonb) con FORMA FIJA y claves nombradas
// (no blob libre), para que una purga ARCO sepa exactamente qué campos contienen
// texto del usuario (value / message_raw / question).

import type { SupabaseClient } from '@supabase/supabase-js';
import { withRetry } from '../../utils/retry';
import { logBotError } from '../../utils/logger';
import {
  CLASSIFIER_MODEL,
  type IntentClassification,
  type MultiIntentClassification,
} from './classifier';

const CLASSIFIER_EVENT_TYPE = 'classifier_output';

// ─── Forma fija del payload (claves nombradas, no blob) ──────────────────────

export type SingleClassifierMetadata = {
  readonly classifier_type: 'single';
  readonly intent:          string;
  readonly confidence:      number;
  readonly value:           string | null;
  readonly message_raw:     string;
};

export type MultiClassifierMetadata = {
  readonly classifier_type: 'multi';
  readonly matches: {
    readonly serviceMatch: MultiIntentClassification['serviceMatch'] | null;
    readonly staffMatch:   MultiIntentClassification['staffMatch']   | null;
    readonly dateMatch:    MultiIntentClassification['dateMatch']    | null;
    readonly timeMatch:    MultiIntentClassification['timeMatch']    | null;
    readonly sideQuestion: MultiIntentClassification['sideQuestion'] | null;
    readonly confirmYes:   boolean | null;
    readonly confirmNo:    boolean | null;
    readonly unclear:      boolean | null;
  };
  readonly message_raw: string;
};

export type ClassifierMetadata = SingleClassifierMetadata | MultiClassifierMetadata;

/** Construye el payload de forma fija para el clasificador single. */
export function buildSingleClassifierMetadata(
  classification: IntentClassification,
  messageRaw:     string,
): SingleClassifierMetadata {
  return {
    classifier_type: 'single',
    intent:          classification.intent,
    confidence:      classification.confidence,
    value:           classification.value,
    message_raw:     messageRaw,
  };
}

/** Construye el payload de forma fija para el clasificador multi (todas las claves presentes). */
export function buildMultiClassifierMetadata(
  multi:      MultiIntentClassification,
  messageRaw: string,
): MultiClassifierMetadata {
  return {
    classifier_type: 'multi',
    matches: {
      serviceMatch: multi.serviceMatch ?? null,
      staffMatch:   multi.staffMatch   ?? null,
      dateMatch:    multi.dateMatch    ?? null,
      timeMatch:    multi.timeMatch    ?? null,
      sideQuestion: multi.sideQuestion ?? null,
      confirmYes:   multi.confirmYes   ?? null,
      confirmNo:    multi.confirmNo    ?? null,
      unclear:      multi.unclear      ?? null,
    },
    message_raw: messageRaw,
  };
}

// ─── Escritura fire-and-forget ───────────────────────────────────────────────

/**
 * Persiste un evento classifier_output en bot_logs. NO bloqueante.
 *
 * state_from / state_to son NOT NULL en bot_logs; como este evento no es una
 * transición de FSM, ambos se llenan con el estado actual del handler.
 */
export function logClassifierOutput(input: {
  supabase:      SupabaseClient;
  businessId:    string;
  customerPhone: string;
  state:         string;
  metadata:      ClassifierMetadata;
}): void {
  const { supabase, businessId, customerPhone, state, metadata } = input;

  void (async () => {
    try {
      await withRetry(
        async () => {
          const { error } = await supabase.from('bot_logs').insert({
            business_id:    businessId,
            customer_phone: customerPhone,
            state_from:     state,
            state_to:       state,
            event_type:     CLASSIFIER_EVENT_TYPE,
            model_used:     CLASSIFIER_MODEL,
            metadata,
          });
          if (error) throw error;
        },
        2,
      );
    } catch (err) {
      logBotError({
        ts:             new Date().toISOString(),
        service:        'bot',
        business_id:    businessId,
        customer_phone: customerPhone,
        state_from:     state,
        state_to:       state,
        model_used:     CLASSIFIER_MODEL,
        error_code:     'classifier_log_write_failed',
        error_message:  err instanceof Error ? err.message : String(err),
        recovered:      true,
      });
    }
  })();
}
