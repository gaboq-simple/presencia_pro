// ─── Sellers Portal — Notificaciones WhatsApp ────────────────────────────────
// Módulo central de notificaciones para el portal de vendedores.
// Usa Meta Graph API v20.0 con el número de WhatsApp Business de PresenciaPro.
//
// REGLA: Todas las funciones exportadas son best-effort.
//        Nunca lanzan excepción al caller — fallos se logean internamente.
// REGLA: Los callers SIEMPRE deben usar try/catch al invocar estas funciones.

import type { Seller } from '@presenciapro/engine/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const META_GRAPH_BASE = 'https://graph.facebook.com/v20.0';

// ─── sendWA (base privada) ────────────────────────────────────────────────────

/**
 * Envía un mensaje de texto vía WhatsApp Business API (Meta Graph v20.0).
 * Lanza error si la respuesta no es 2xx — el caller debe manejar.
 */
async function sendWA(to: string, message: string): Promise<void> {
  const phoneId = process.env['PRESENCIAPRO_WA_PHONE_ID'];
  const accessToken = process.env['PRESENCIAPRO_WA_ACCESS_TOKEN'];

  if (!phoneId || !accessToken) {
    throw new Error('PRESENCIAPRO_WA_PHONE_ID o PRESENCIAPRO_WA_ACCESS_TOKEN no configurados');
  }

  const response = await fetch(`${META_GRAPH_BASE}/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  });

  if (!response.ok) {
    const errorData = (await response.json()) as { error?: { message?: string } };
    throw new Error(
      `WhatsApp API ${response.status}: ${errorData.error?.message ?? 'Error desconocido'}`,
    );
  }
}

// ─── Funciones exportadas ─────────────────────────────────────────────────────

/**
 * Notifica al vendedor que su prospecto fue registrado exitosamente.
 * Best-effort — nunca lanza.
 */
export async function notifySellerLeadRegistered(params: {
  readonly seller: Seller;
  readonly doctorName: string;
  readonly city: string;
  readonly specialty?: string | null;
}): Promise<void> {
  const { seller, doctorName, city, specialty } = params;
  const label = specialty ?? city;

  try {
    await sendWA(
      seller.phone,
      `✅ Prospecto registrado: ${doctorName} · ${label}\n` +
        `Tienes exclusividad por 30 días. ¡Suerte! 💪`,
    );
  } catch {
    // best-effort
  }
}

/**
 * Notifica al operador que un nuevo lead fue registrado.
 * Best-effort — nunca lanza.
 */
export async function notifyOperatorNewLead(params: {
  readonly seller: Seller;
  readonly doctorName: string;
  readonly doctorPhone: string;
  readonly city: string;
  readonly specialty?: string | null;
}): Promise<void> {
  const { seller, doctorName, doctorPhone, city, specialty } = params;
  const operatorPhone = process.env['OPERATOR_WHATSAPP'];

  if (!operatorPhone) return;

  try {
    await sendWA(
      operatorPhone,
      `🔔 Nuevo lead registrado\n` +
        `Doctor: ${doctorName} · ${specialty ?? 'Sin especialidad'} · ${city}\n` +
        `Tel: ${doctorPhone}\n` +
        `Vendedor: ${seller.name}`,
    );
  } catch {
    // best-effort
  }
}

/**
 * Notifica al vendedor que el deploy del cliente fue completado.
 * Best-effort — nunca lanza.
 */
export async function notifySellerDeployComplete(params: {
  readonly seller: Seller;
  readonly doctorName: string;
  readonly commissionMxn: number;
}): Promise<void> {
  const { seller, doctorName, commissionMxn } = params;

  try {
    await sendWA(
      seller.phone,
      `🚀 ¡Deploy completado! ${doctorName} ya está en línea.\n` +
        `Tu comisión de setup: $${commissionMxn.toLocaleString('es-MX')} MXN\n` +
        `Ya aparece en tu portal 🎉`,
    );
  } catch {
    // best-effort
  }
}

/**
 * Notifica al vendedor que se realizó una transferencia de sus comisiones.
 * Best-effort — nunca lanza.
 */
export async function notifySellerPaymentSent(params: {
  readonly seller: Seller;
  readonly totalMxn: number;
}): Promise<void> {
  const { seller, totalMxn } = params;

  try {
    await sendWA(
      seller.phone,
      `💸 Transferencia enviada: $${totalMxn.toLocaleString('es-MX')} MXN\n` +
        `Ya puedes verificarlo en tu cuenta. ¡Gracias por tu trabajo! 🙌`,
    );
  } catch {
    // best-effort
  }
}

/**
 * Notifica al vendedor sobre un lead sin avanzar.
 * Best-effort — nunca lanza.
 */
export async function notifySellerStaleLead(params: {
  readonly seller: Seller;
  readonly doctorName: string;
  readonly daysStale: number;
  readonly isUrgent: boolean;
}): Promise<void> {
  const { seller, doctorName, daysStale, isUrgent } = params;
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? '';

  try {
    const message = isUrgent
      ? `⚠️ Atención: ${doctorName} pierde exclusividad en 2 días.\n` +
        `Si no avanza de estado otro vendedor podrá registrarlo.\n` +
        `Entra ahora: ${appUrl}/dashboard`
      : `👋 Recordatorio: ${doctorName} lleva ${daysStale} días sin avanzar.\n` +
        `¿Pudiste hablar con él/ella? Actualiza el estado en tu portal.`;

    await sendWA(seller.phone, message);
  } catch {
    // best-effort
  }
}

/**
 * Envía el resumen mensual de comisiones al vendedor.
 * Best-effort — nunca lanza.
 */
export async function notifySellerMonthlyReport(params: {
  readonly seller: Seller;
  readonly monthLabel: string;
  readonly totalGeneratedMxn: number;
  readonly activeClientsCount: number;
}): Promise<void> {
  const { seller, monthLabel, totalGeneratedMxn, activeClientsCount } = params;

  try {
    await sendWA(
      seller.phone,
      `📊 Resumen ${monthLabel}:\n` +
        `Generaste $${totalGeneratedMxn.toLocaleString('es-MX')} MXN\n` +
        `Clientes activos: ${activeClientsCount}\n` +
        `¡Sigue así! 💪`,
    );
  } catch {
    // best-effort
  }
}
