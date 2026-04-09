// ─── API Route: POST /api/reports/monthly ─────────────────────────────────────
// Llamado por la Edge Function dispatch-monthly-report el día 1 de cada mes.
// Genera y envía el reporte mensual al doctor por WhatsApp y email.
//
// Autenticación: header x-cron-secret debe coincidir con CRON_SECRET env var.
// Idempotencia: si ya existe un registro en monthly_reports para este client+año+mes,
//   retorna 200 sin reenviar.
//
// Body opcional: { year?: number; month?: number }
//   Si no se pasa, el reporte cubre el mes anterior al momento del llamado.

import { createClient } from '@supabase/supabase-js';
import { getMonthlyMetrics } from '@presenciapro/engine/dashboard';
import { sendWhatsApp, sendEmail } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials, ResendCredentials } from '@presenciapro/engine/notifications';
import { clientConfig } from '@/config/client.config';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Nombre del mes en español (1=enero … 12=diciembre) */
function mesEnEspanol(month: number): string {
  const nombres = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return nombres[month - 1] ?? String(month);
}

/** Signo + cuando el número es positivo, vacío si cero, - si negativo */
function formatDelta(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

/** Formatea tasa como porcentaje: 0.1234 → "12%" */
function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ─── WhatsApp message builder ─────────────────────────────────────────────────

function buildWhatsAppText(params: {
  clientName: string;
  year: number;
  month: number;
  metrics: ReturnType<typeof getMonthlyMetrics> extends Promise<infer T> ? T : never;
}): string {
  const { clientName, year, month, metrics } = params;
  const mes = mesEnEspanol(month);

  const comparativo =
    metrics.previousCompleted > 0
      ? ` (${formatDelta(metrics.completedDelta)} vs mes anterior, ${formatDelta(metrics.completedDeltaPct)}%)`
      : '';

  const topServicesLines = metrics.topServices
    .map((s, i) => `${i === 0 ? '⭐' : '  '} ${s.serviceName}: ${s.count} cita${s.count !== 1 ? 's' : ''}`)
    .join('\n');

  const noShowPct = formatPct(metrics.noShowRate);

  return [
    `📊 Reporte de ${mes} ${year}, ${clientName}`,
    '',
    `✅ Citas realizadas: ${metrics.completed}${comparativo}`,
    `❌ No-shows: ${metrics.noShows} (${noShowPct})`,
    '',
    ...(metrics.topServices.length > 0 ? [topServicesLines, ''] : []),
    `👤 Nuevos: ${metrics.newPatients} | Recurrentes: ${metrics.returningPatients}`,
    '',
    'Te enviamos el reporte completo por email 📩',
  ].join('\n');
}

// ─── Email HTML builder ───────────────────────────────────────────────────────

function buildEmailHtml(params: {
  clientName: string;
  year: number;
  month: number;
  metrics: ReturnType<typeof getMonthlyMetrics> extends Promise<infer T> ? T : never;
}): { html: string; text: string } {
  const { clientName, year, month, metrics } = params;
  const mes = mesEnEspanol(month);
  const colors = clientConfig.design.colors;
  const borderRadius = clientConfig.design.borderRadius;

  const comparativoHtml =
    metrics.previousCompleted > 0
      ? `<span style="color:${metrics.completedDelta >= 0 ? '#16a34a' : '#dc2626'}; font-weight:600;">${formatDelta(metrics.completedDelta)} (${formatDelta(metrics.completedDeltaPct)}%)</span> vs mes anterior`
      : '<span style="color:#6b7280;">— primer mes sin comparativo</span>';

  const topServicesHtml =
    metrics.topServices.length > 0
      ? metrics.topServices
          .map(
            (s, i) =>
              `<tr>
                <td style="padding:6px 12px; font-weight:${i === 0 ? '600' : '400'};">
                  ${i === 0 ? '⭐ ' : ''}${s.serviceName}
                </td>
                <td style="padding:6px 12px; text-align:right; font-weight:${i === 0 ? '600' : '400'};">
                  ${s.count} cita${s.count !== 1 ? 's' : ''}
                </td>
              </tr>`,
          )
          .join('')
      : '<tr><td colspan="2" style="padding:6px 12px; color:#6b7280;">Sin datos de servicios este mes</td></tr>';

  const noShowPct = formatPct(metrics.noShowRate);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reporte de ${mes} ${year} — ${clientName}</title>
</head>
<body style="margin:0; padding:0; background-color:${colors.background}; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${colors.background};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

          <!-- Header -->
          <tr>
            <td style="background-color:${colors.primary}; border-radius:${borderRadius} ${borderRadius} 0 0; padding:28px 32px; text-align:center;">
              <p style="margin:0; font-size:13px; color:${colors.white}; opacity:0.85; text-transform:uppercase; letter-spacing:0.08em;">Reporte mensual</p>
              <h1 style="margin:6px 0 0; font-size:22px; font-weight:700; color:${colors.white};">${mesEnEspanol(month).charAt(0).toUpperCase() + mesEnEspanol(month).slice(1)} ${year}</h1>
              <p style="margin:4px 0 0; font-size:14px; color:${colors.white}; opacity:0.85;">${clientName}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:${colors.surface}; padding:32px; border:1px solid ${colors.border}; border-top:none; border-radius:0 0 ${borderRadius} ${borderRadius};">

              <!-- Métricas principales -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td width="50%" style="padding:0 8px 0 0;">
                    <div style="background:${colors.white}; border:1px solid ${colors.border}; border-radius:${borderRadius}; padding:16px; text-align:center;">
                      <p style="margin:0; font-size:32px; font-weight:700; color:${colors.primary};">${metrics.completed}</p>
                      <p style="margin:4px 0 0; font-size:12px; color:${colors.textMuted}; text-transform:uppercase; letter-spacing:0.05em;">Citas realizadas</p>
                      <p style="margin:6px 0 0; font-size:12px;">${comparativoHtml}</p>
                    </div>
                  </td>
                  <td width="50%" style="padding:0 0 0 8px;">
                    <div style="background:${colors.white}; border:1px solid ${colors.border}; border-radius:${borderRadius}; padding:16px; text-align:center;">
                      <p style="margin:0; font-size:32px; font-weight:700; color:${metrics.noShowRate > 0.15 ? '#dc2626' : colors.text};">${metrics.noShows}</p>
                      <p style="margin:4px 0 0; font-size:12px; color:${colors.textMuted}; text-transform:uppercase; letter-spacing:0.05em;">No-shows</p>
                      <p style="margin:6px 0 0; font-size:12px; color:${colors.textMuted};">${noShowPct} del total agendado</p>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Servicios más solicitados -->
              <h2 style="margin:0 0 12px; font-size:14px; font-weight:600; color:${colors.text}; text-transform:uppercase; letter-spacing:0.06em;">Servicios más solicitados</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colors.white}; border:1px solid ${colors.border}; border-radius:${borderRadius}; margin-bottom:24px; font-size:14px; color:${colors.text};">
                ${topServicesHtml}
              </table>

              <!-- Pacientes -->
              <h2 style="margin:0 0 12px; font-size:14px; font-weight:600; color:${colors.text}; text-transform:uppercase; letter-spacing:0.06em;">Pacientes</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colors.white}; border:1px solid ${colors.border}; border-radius:${borderRadius}; font-size:14px; color:${colors.text};">
                <tr>
                  <td style="padding:10px 12px; border-bottom:1px solid ${colors.border};">
                    👤 Nuevos este mes
                  </td>
                  <td style="padding:10px 12px; border-bottom:1px solid ${colors.border}; text-align:right; font-weight:600;">
                    ${metrics.newPatients}
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;">
                    🔄 Recurrentes
                  </td>
                  <td style="padding:10px 12px; text-align:right; font-weight:600;">
                    ${metrics.returningPatients}
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 0; text-align:center;">
              <p style="margin:0; font-size:12px; color:${colors.textMuted};">
                ${clientName} · Reporte generado automáticamente por PresenciaPro OS
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Fallback texto plano
  const text = [
    `Reporte de ${mesEnEspanol(month)} ${year} — ${clientName}`,
    '',
    `Citas realizadas: ${metrics.completed}`,
    `No-shows: ${metrics.noShows} (${noShowPct})`,
    '',
    'Servicios más solicitados:',
    ...metrics.topServices.map((s) => `  ${s.serviceName}: ${s.count} citas`),
    '',
    `Pacientes nuevos: ${metrics.newPatients}`,
    `Pacientes recurrentes: ${metrics.returningPatients}`,
  ].join('\n');

  return { html, text };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MonthlyReportRow = {
  id: string;
};

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  // Guard: autenticación del cron
  const cronSecret = request.headers.get('x-cron-secret');
  if (!process.env['CRON_SECRET'] || cronSecret !== process.env['CRON_SECRET']) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Guard: variables de entorno requeridas
  const supabaseUrl       = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey    = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const whatsappSid       = process.env['WHATSAPP_ACCESS_TOKEN'];
  const whatsappAuthToken = process.env['WHATSAPP_PHONE_NUMBER_ID'];
  const resendApiKey      = process.env['RESEND_API_KEY'];
  const resendFrom        = process.env['RESEND_FROM_EMAIL'];

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[monthly-report] missing Supabase env vars');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Determinar el mes del reporte ─────────────────────────────────────────────
  // Por defecto: el mes anterior al momento del llamado.
  // Se puede sobreescribir con body { year, month } para pruebas manuales.
  let reportYear: number;
  let reportMonth: number;

  try {
    const body = await request.json() as { year?: unknown; month?: unknown };
    const now = new Date();
    const defaultMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
    const defaultYear  = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();

    reportYear  = typeof body.year  === 'number' ? body.year  : defaultYear;
    reportMonth = typeof body.month === 'number' ? body.month : defaultMonth;
  } catch {
    const now = new Date();
    reportMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
    reportYear  = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  }

  const clientId = clientConfig.client.id;

  // ── Idempotencia ──────────────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('monthly_reports')
    .select('id')
    .eq('client_id', clientId)
    .eq('year', reportYear)
    .eq('month', reportMonth)
    .maybeSingle();

  if ((existing as MonthlyReportRow | null) !== null) {
    console.log(`[monthly-report] ${clientId} ${reportYear}-${reportMonth} ya enviado — skip`);
    return new Response(JSON.stringify({ skipped: true, reason: 'already_sent' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Build serviceNameMap desde config ─────────────────────────────────────────
  // El engine nunca importa client.config — el API Route construye el map e inyecta.
  const serviceNameMap = new Map<string, string>(
    clientConfig.services.map((s) => [s.id, s.name]),
  );

  // ── Obtener métricas ──────────────────────────────────────────────────────────
  const metrics = await getMonthlyMetrics({
    clientId,
    year:           reportYear,
    month:          reportMonth,
    serviceNameMap,
    supabase,
  });

  const clientName = clientConfig.client.name;

  // ── Construir mensajes ────────────────────────────────────────────────────────
  const whatsappText = buildWhatsAppText({ clientName, year: reportYear, month: reportMonth, metrics });
  const { html: emailHtml, text: emailText } = buildEmailHtml({ clientName, year: reportYear, month: reportMonth, metrics });

  // ── Enviar WhatsApp al especialista ───────────────────────────────────────────
  let whatsappSent = false;

  if (whatsappSid && whatsappAuthToken) {
    const specialist = clientConfig.specialists[0];
    if (specialist) {
      const whatsappCreds: WhatsAppCredentials = {
        accountSid:  whatsappSid,
        authToken:   whatsappAuthToken,
        fromNumber:  clientConfig.contact.whatsapp,
      };

      const waResult = await sendWhatsApp(
        { to: specialist.whatsapp, body: whatsappText },
        whatsappCreds,
      );

      whatsappSent = waResult.success;
      if (!waResult.success) {
        console.error(`[monthly-report] WhatsApp failed: ${waResult.error}`);
      }
    }
  } else {
    console.warn('[monthly-report] WhatsApp env vars no configurados — omitiendo envío');
  }

  // ── Enviar email al doctor ────────────────────────────────────────────────────
  let emailSent = false;
  const reportEmail = clientConfig.contact.reportEmail;

  if (reportEmail && resendApiKey && resendFrom) {
    const resendCreds: ResendCredentials = {
      apiKey:      resendApiKey,
      fromAddress: resendFrom,
    };

    const mes = mesEnEspanol(reportMonth);
    const mesCapitalizado = mes.charAt(0).toUpperCase() + mes.slice(1);

    const emailResult = await sendEmail(
      {
        to:      reportEmail,
        subject: `Reporte de ${mesCapitalizado} ${reportYear} — ${clientName}`,
        html:    emailHtml,
        text:    emailText,
      },
      resendCreds,
    );

    emailSent = emailResult.success;
    if (!emailResult.success) {
      console.error(`[monthly-report] email failed: ${emailResult.error}`);
    }
  } else if (!reportEmail) {
    console.log('[monthly-report] reportEmail no configurado — omitiendo envío de email');
  } else {
    console.warn('[monthly-report] Resend env vars no configurados — omitiendo envío de email');
  }

  // ── Registrar en monthly_reports ─────────────────────────────────────────────
  const { error: insertError } = await supabase
    .from('monthly_reports')
    .insert({
      client_id:     clientId,
      year:          reportYear,
      month:         reportMonth,
      whatsapp_sent: whatsappSent,
      email_sent:    emailSent,
    });

  if (insertError) {
    // No lanzar — el reporte ya fue enviado, solo falló el registro
    console.error(`[monthly-report] failed to insert record: ${insertError.message}`);
  }

  console.log(`[monthly-report] ${clientId} ${reportYear}-${reportMonth} done`, {
    whatsappSent,
    emailSent,
  });

  return new Response(
    JSON.stringify({
      clientId,
      year:          reportYear,
      month:         reportMonth,
      whatsappSent,
      emailSent,
      completed:     metrics.completed,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
