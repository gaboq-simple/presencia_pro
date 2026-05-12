// ─── State: FALLBACK / ESCALATED ─────────────────────────────────────────────
// Maneja input no reconocido en cualquier punto del flujo.
//
// - Responde con el fallbackMessage configurado del negocio.
// - Después de fallbackAttempts >= 2: escala a humano.
//   → Notifica al admin del negocio vía sendWhatsAppMeta() best-effort.
//   → Estado → ESCALATED.

import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { sendWhatsAppMeta } from '../../../notifications/whatsapp';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

const MAX_FALLBACK_ATTEMPTS = 2;

export async function handleFallback(
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase } = deps;

  const attempts = (context.fallbackAttempts ?? 0) + 1;

  if (attempts >= MAX_FALLBACK_ATTEMPTS) {
    // ── Escalar a humano ───────────────────────────────────────────────────

    // Notificar al admin del negocio — best-effort
    try {
      const { data: adminStaff } = await supabase
        .from('staff')
        .select('whatsapp_id')
        .eq('business_id', business.id)
        .eq('role', 'admin')
        .eq('active', true)
        .limit(1)
        .maybeSingle();

      const adminWhatsappId = (adminStaff as { whatsapp_id: string } | null)?.whatsapp_id;

      if (adminWhatsappId) {
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
      }
    } catch {
      // Best-effort — no bloquear
    }

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
