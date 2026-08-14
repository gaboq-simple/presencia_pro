// ─── Digest del operador — las señales llegan solas (D7) ─────────────────────
// Un correo semanal a Gabriel con las cuatro señales de la tabla "Cómo se ve el
// fracaso" del plan. No es un reporte para el dueño del negocio: es el
// instrumento del OPERADOR, y por eso va por correo (Resend) y no por WhatsApp
// — la WABA sigue sin verificar y gatearía justo la señal que avisa que algo no
// está funcionando.
//
// 🔴 SE ENVÍA SIEMPRE, aunque las cuatro señales estén en verde. El silencio no
//    puede significar dos cosas a la vez: si el correo solo llegara cuando hay
//    problema, un lunes sin correo sería indistinguible de "la tubería se
//    rompió" — que es exactamente el modo de falla que este digest existe para
//    hacer visible. El correo de un lunes tranquilo ES el meta-aviso.
//
// 🔴 ESTADOS HONESTOS (patrón de D5/D6): el envío se intenta de verdad y la
//    respuesta dice qué pasó. Sin `RESEND_API_KEY` o sin `OPS_ALERT_EMAIL` la
//    ruta responde con el motivo y `sent: false` — nunca reporta un envío que no
//    ocurrió. El cuerpo calculado viaja igual en la respuesta, así que el digest
//    se puede leer por curl aunque el correo no salga.
//
// Auth: Bearer CRON_SECRET, igual que el nudge.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { todayStrInTz } from '@/lib/dayWindow';
import { computeSenales, type Senales } from '@/lib/senales';
import { getEntradaSenales } from '@/lib/senalesData';
import { sendEmail, wrapHtml } from '@presenciapro/engine/notifications';

export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

type BizRow = {
  id: string;
  slug: string;
  name: string;
  timezone: string | null;
  owner_last_seen_at: string | null;
};

type SeccionNegocio = { slug: string; nombre: string; hoy: string; senales: Senales };

/** El lunes de la semana de `fecha` ('YYYY-MM-DD'), para el asunto. */
export function lunesDe(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const dow = t.getUTCDay();               // 0=domingo
  const aLunes = dow === 0 ? -6 : 1 - dow; // el domingo pertenece a la semana que termina
  t.setUTCDate(t.getUTCDate() + aLunes);
  return t.toISOString().slice(0, 10);
}

/** Texto plano del digest. Dato + umbral por señal; ninguna conclusión. */
export function buildDigestTexto(secciones: readonly SeccionNegocio[]): string {
  if (secciones.length === 0) return 'No hay negocios activos.';
  return secciones
    .map((s) => [
      `${s.nombre} (${s.slug}) · al ${s.hoy}`,
      `  Ritual        ${s.senales.ritual.texto}`,
      `  Convergencia  ${s.senales.convergencia.texto}`,
      `  Teatro        ${s.senales.teatro.texto}`,
      `  Dueño         ${s.senales.dueno.texto}`,
    ].join('\n'))
    .join('\n\n');
}

function buildDigestHtml(secciones: readonly SeccionNegocio[]): string {
  const cuerpo = secciones.length === 0
    ? '<p>No hay negocios activos.</p>'
    : secciones.map((s) => `
      <h2 style="font-size:15px;margin:24px 0 8px">${s.nombre} <span style="color:#9ca3af;font-weight:normal">(${s.slug}) · al ${s.hoy}</span></h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 0;color:#6b7280;width:130px">Ritual</td><td>${s.senales.ritual.texto}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Convergencia</td><td>${s.senales.convergencia.texto}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Teatro</td><td>${s.senales.teatro.texto}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Dueño</td><td>${s.senales.dueno.texto}</td></tr>
      </table>`).join('');

  return wrapHtml('Zlot · señales', `
    <p>Las cuatro señales de la capa de dinero. Cada una va con su umbral al lado;
    la lectura es tuya.</p>
    ${cuerpo}
    <p style="margin-top:24px;color:#9ca3af;font-size:12px">
      Este correo llega todos los lunes, en verde o en rojo: un lunes sin correo
      significa que la tubería se rompió, no que todo esté bien.
    </p>`);
}

export async function POST(request: Request): Promise<NextResponse> {
  const cronSecret = process.env['CRON_SECRET'];
  const authHeader = request.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const supabase = getServiceClient();

  // Barrido cross-tenant deliberado (mismo caso que el nudge): no hay sesión de
  // la cual derivar un business_id. `businesses` es la raíz y no la cubre el
  // helper; cada lectura de adentro sí va scopeada.
  const { data: bizData, error } = await supabase
    .from('businesses')
    .select('id, slug, name, timezone, owner_last_seen_at')
    .eq('active', true);

  if (error) {
    return NextResponse.json({ error: `businesses: ${error.message}` }, { status: 500 });
  }

  const secciones: SeccionNegocio[] = [];
  for (const raw of (bizData ?? []) as BizRow[]) {
    const tz = raw.timezone ?? 'America/Mexico_City';
    const hoy = todayStrInTz(tz);
    const entrada = await getEntradaSenales(raw.id, tz, raw.owner_last_seen_at, hoy);
    secciones.push({ slug: raw.slug, nombre: raw.name, hoy, senales: computeSenales(entrada) });
  }

  const texto = buildDigestTexto(secciones);
  const lunes = lunesDe(secciones[0]?.hoy ?? todayStrInTz('America/Mexico_City'));
  const subject = `Zlot · señales · semana del ${lunes}`;

  // ── El envío ───────────────────────────────────────────────────────────────
  const apiKey = process.env['RESEND_API_KEY'];
  const to     = process.env['OPS_ALERT_EMAIL'];
  // El remitente por defecto es el sandbox de Resend, que SOLO entrega a la
  // cuenta dueña de la API key — que acá es el operador, o sea el destinatario
  // correcto. Con dominio verificado se sobrescribe con OPS_ALERT_FROM.
  const from   = process.env['OPS_ALERT_FROM'] ?? 'Zlot <onboarding@resend.dev>';

  let sent = false;
  let sendError: string | null = null;

  if (!apiKey)      sendError = 'falta RESEND_API_KEY';
  else if (!to)     sendError = 'falta OPS_ALERT_EMAIL';
  else {
    const res = await sendEmail(
      { to, subject, html: buildDigestHtml(secciones), text: texto },
      { apiKey, fromAddress: from },
    );
    sent = res.success;
    if (!res.success) sendError = res.error ?? 'no se pudo enviar';
  }

  return NextResponse.json({
    subject,
    negocios: secciones.length,
    sent,
    ...(sendError ? { error: sendError } : {}),
    // El digest calculado viaja SIEMPRE: si el correo no salió, esto es lo que
    // se lee por curl, y es el mismo texto que habría ido adentro.
    digest: texto,
    senales: secciones,
  });
}
