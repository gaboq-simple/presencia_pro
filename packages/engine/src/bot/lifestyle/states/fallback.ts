// ─── State: FALLBACK / ESCALATED ─────────────────────────────────────────────
// Maneja input no reconocido en cualquier punto del flujo.
//
// - Responde con el fallbackMessage configurado del negocio.
// - Después de fallbackAttempts >= 2: escala a humano (estado ESCALATED).
//
// AUD-03: la notificación al admin ya NO vive aquí — la dispara dispatch()
// (router.ts) en el MISMO turno en que cualquier camino transiciona a
// ESCALATED (fallback, rechazo ×4, cap estructural). Antes era un gap doble:
// el rechazo sembraba fallbackAttempts:2 esperando que el PRÓXIMO mensaje
// notificara vía este handler, pero el reset de terminales corría antes del
// dispatch → el case ESCALATED nunca ejecutaba y el admin no se enteraba nunca.

import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { tenantDb } from '../../../tenantDb';
import { sendWhatsAppMeta } from '../../../notifications/whatsapp';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

const MAX_FALLBACK_ATTEMPTS = 2;

/**
 * Aviso al admin del negocio de que un cliente quedó escalado — best-effort.
 * La invoca dispatch() al detectar la transición a ESCALATED (una sola vez por
 * escalada, deduplicada con context.escalation_notified).
 *
 * Nunca lanza. Si no puede enviar (sin admin activo con whatsapp_id, sin
 * token, o falla de red), lo deja visible en logs — antes fallaba en silencio
 * absoluto y la promesa "te comunico con el equipo" quedaba huérfana.
 */
export async function notifyAdminOfEscalation(
  msg:  LifestyleIncomingMessage,
  deps: StateHandlerDeps,
): Promise<void> {
  const { business, supabase } = deps;
  try {
    const { data: adminStaff } = await tenantDb(supabase, business.id)
      .table('staff')
      .select('whatsapp_id')
      .eq('role', 'admin')
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    const adminWhatsappId = (adminStaff as { whatsapp_id: string } | null)?.whatsapp_id;

    if (!adminWhatsappId || !process.env['WHATSAPP_ACCESS_TOKEN']) {
      console.error(JSON.stringify({
        ts:          new Date().toISOString(),
        service:     'bot',
        event:       'escalation_notify_skipped',
        reason:      !adminWhatsappId ? 'no_admin_whatsapp' : 'no_access_token',
        business_id: business.id,
      }));
      return;
    }

    await sendWhatsAppMeta(
      {
        to:   adminWhatsappId,
        body: `⚠️ Cliente requiere atención humana.\nTeléfono: ${msg.customerPhone}\nÚltimo mensaje: "${msg.body}"`,
      },
      {
        accessToken:   process.env['WHATSAPP_ACCESS_TOKEN'] ?? '',
        phoneNumberId: business.whatsappPhoneNumberId,
      },
    );
  } catch (err) {
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'bot',
      event:       'escalation_notify_failed',
      error:       err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      business_id: business.id,
    }));
  }
}

export async function handleFallback(
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business } = deps;
  void msg;

  const attempts = (context.fallbackAttempts ?? 0) + 1;

  if (attempts >= MAX_FALLBACK_ATTEMPTS) {
    // Escalar a humano. La notificación al admin la dispara dispatch() al ver
    // la transición (mismo turno que esta promesa — atómico).
    return {
      newState:     'ESCALATED',
      newContext:   { ...context, fallbackAttempts: attempts },
      responseText:
        'Enseguida te comunico con nuestro equipo para que te ayuden personalmente. Gracias por tu paciencia! 🙏',
    };
  }

  return {
    newState:     'FALLBACK',
    newContext:   { ...context, fallbackAttempts: attempts },
    responseText: business.fallbackMessage,
  };
}
