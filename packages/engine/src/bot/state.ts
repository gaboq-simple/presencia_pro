// ─── Conversation State — Supabase persistence ────────────────────────────────
// Lee y escribe ConversationState en la tabla bot_conversations.
// Todo query incluye client_id en el WHERE — nunca se mezclan clientes.
// Usa service_role_key — solo ejecutar en servidor.

import { createClient } from '@supabase/supabase-js';
import type { ConversationContext, ConversationState, ConversationStep } from './types';

// ─── Supabase client ──────────────────────────────────────────────────────────

function getSupabaseClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(url, key);
}

// ─── DB row shape ─────────────────────────────────────────────────────────────

type ConversationRow = {
  id: string;
  client_id: string;
  whatsapp_id: string;
  state: string;
  context: Record<string, unknown>;
  last_message: string;
  created_at: string;
};

function rowToState(row: ConversationRow): ConversationState {
  return {
    id: row.id,
    clientId: row.client_id,
    whatsappId: row.whatsapp_id,
    state: row.state as ConversationStep,
    context: row.context as ConversationContext,
    lastMessage: new Date(row.last_message),
  };
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Retorna la conversación activa del paciente para este cliente.
 * Busca por whatsapp_id normalizado — no por patient_phone legacy.
 * Retorna null si no existe — el caller decide si crear una nueva.
 */
export async function getConversation(
  clientId: string,
  whatsappId: string,
): Promise<ConversationState | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('bot_conversations')
    .select('*')
    .eq('client_id', clientId)
    .eq('whatsapp_id', whatsappId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getConversation failed: ${error.message}`);
  if (!data) return null;

  return rowToState(data as ConversationRow);
}

/**
 * Crea una conversación nueva en estado GREETING para el paciente.
 * Persiste whatsapp_id normalizado y mantiene patient_phone para compatibilidad.
 */
export async function createConversation(
  clientId: string,
  whatsappId: string,
): Promise<ConversationState> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('bot_conversations')
    .insert({
      client_id:    clientId,
      whatsapp_id:  whatsappId,
      patient_phone: whatsappId,  // mantener patient_phone por compatibilidad con datos existentes
      state: 'GREETING' satisfies ConversationStep,
      context: {},
      last_message: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`createConversation failed: ${error.message}`);

  return rowToState(data as ConversationRow);
}

/**
 * Actualiza la conversación con los cambios parciales indicados.
 * El contexto se fusiona (merge) — no reemplaza el objeto completo.
 */
export async function updateConversation(
  id: string,
  updates: {
    state?: ConversationStep;
    context?: Partial<ConversationContext>;
  },
): Promise<ConversationState> {
  const supabase = getSupabaseClient();

  // Guard: fetch current context first to merge, not overwrite
  const { data: current, error: fetchError } = await supabase
    .from('bot_conversations')
    .select('context')
    .eq('id', id)
    .single();

  if (fetchError) throw new Error(`updateConversation fetch failed: ${fetchError.message}`);

  const mergedContext = {
    ...(current as { context: Record<string, unknown> }).context,
    ...(updates.context ?? {}),
  };

  const payload: Record<string, unknown> = {
    context: mergedContext,
    last_message: new Date().toISOString(),
  };

  if (updates.state !== undefined) {
    payload['state'] = updates.state;
  }

  const { data, error } = await supabase
    .from('bot_conversations')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`updateConversation failed: ${error.message}`);

  return rowToState(data as ConversationRow);
}
