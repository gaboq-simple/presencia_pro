// ─── Nudge "hoy no hubo corte" (D6) ───────────────────────────────────────────
// El hábito del corte no puede depender de que alguien se acuerde. A las 23:00
// del negocio, esta ruta barre los negocios activos y le avisa al dueño de los
// que cerraron el día SIN contar la caja.
//
// Por qué una ruta interna y no una edge function: el cálculo del día local, el
// canal de WhatsApp y la regla de "qué es un corte válido" ya viven acá (D5).
// Duplicarlos en Deno sería tener dos definiciones de lo mismo — el modo de falla
// que la capa de dinero viene evitando desde D1.
//
// 🔴 ESTADOS HONESTOS (patrón del aviso de D5): el envío se INTENTA de verdad y
//    la respuesta dice qué pasó con cada negocio — `sent: true`, o `sent: false`
//    con el error tal como lo devolvió Meta. Nunca se reporta un envío que no
//    ocurrió. Si el token está vencido, la respuesta lo dice y el cron queda
//    ruidoso; un nudge que finge haber salido es peor que uno que no sale.
//
// Auth: Bearer CRON_SECRET (patrón de `api/reports/weekly`). Sin secret
// configurado, la ruta responde 401 — nunca abierta por omisión.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { todayStrInTz } from '@/lib/dayWindow';
import { sendWhatsAppMeta } from '@presenciapro/engine/notifications';

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
  timezone: string | null;
  report_whatsapp: string | null;
  report_enabled: boolean;
  whatsapp_phone_number_id: string | null;
};

type Resultado = {
  slug: string;
  dia: string;
  /** Se le avisó (o se intentó). false = no aplicaba: ya había corte. */
  aplicaba: boolean;
  sent: boolean;
  error?: string;
};

/** El texto. Sujeto = el día, no la persona: es un recordatorio, no un reclamo. */
export function buildNudge(negocio: string): string {
  return `Hoy no hubo corte de caja en ${negocio}. Si el local ya cerró, mañana se puede hacer igual — pero el descuadre de hoy queda sin medir.`;
}

export async function POST(request: Request): Promise<NextResponse> {
  const cronSecret = process.env['CRON_SECRET'];
  const authHeader = request.headers.get('authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const supabase = getServiceClient();

  // Lookup cross-tenant DELIBERADO: el cron barre todos los negocios. No hay
  // sesión de la cual derivar un business_id — es la excepción que el helper
  // documenta (scan por lote), no un olvido.
  const { data: bizData, error } = await supabase
    .from('businesses')
    .select('id, slug, timezone, report_whatsapp, report_enabled, whatsapp_phone_number_id')
    .eq('active', true);

  if (error) {
    return NextResponse.json({ error: `businesses: ${error.message}` }, { status: 500 });
  }

  const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
  const resultados: Resultado[] = [];

  for (const raw of (bizData ?? []) as BizRow[]) {
    if (!raw.report_enabled) continue;

    const tz = raw.timezone ?? 'America/Mexico_City';
    const dia = todayStrInTz(tz);

    // El barrido es cross-tenant, pero CADA lectura va scopeada por su negocio:
    // el `business_id` sale de la fila que se está recorriendo, no de un filtro
    // que alguien pueda olvidar. (La lint lo cazó en la primera versión de esta
    // ruta — para eso `caja_cortes` entró a TENANT_TABLES en D4.)
    const { data: cortes } = await tenantDb(supabase, raw.id)
      .table('caja_cortes')
      .select('id')
      .eq('corte_date', dia)
      .limit(1);

    if ((cortes ?? []).length > 0) {
      resultados.push({ slug: raw.slug, dia, aplicaba: false, sent: false });
      continue;
    }

    // Sin corte: hay que avisar. Cada motivo por el que NO se puede enviar se
    // reporta tal cual — la ruta no elige un fallback ni se calla.
    if (!raw.report_whatsapp) {
      resultados.push({ slug: raw.slug, dia, aplicaba: true, sent: false, error: 'sin report_whatsapp configurado' });
      continue;
    }
    if (!raw.whatsapp_phone_number_id) {
      resultados.push({ slug: raw.slug, dia, aplicaba: true, sent: false, error: 'sin whatsapp_phone_number_id' });
      continue;
    }
    if (!accessToken) {
      resultados.push({ slug: raw.slug, dia, aplicaba: true, sent: false, error: 'falta WHATSAPP_ACCESS_TOKEN' });
      continue;
    }

    try {
      const res = await sendWhatsAppMeta(
        { to: raw.report_whatsapp, body: buildNudge(raw.slug) },
        { accessToken, phoneNumberId: raw.whatsapp_phone_number_id },
      );
      resultados.push({
        slug: raw.slug, dia, aplicaba: true,
        sent: res.success,
        ...(res.success ? {} : { error: res.error ?? 'no se pudo enviar' }),
      });
    } catch (e) {
      resultados.push({
        slug: raw.slug, dia, aplicaba: true, sent: false,
        error: e instanceof Error ? e.message : 'no se pudo enviar',
      });
    }
  }

  const avisados = resultados.filter((r) => r.aplicaba).length;
  const enviados = resultados.filter((r) => r.sent).length;

  return NextResponse.json({
    revisados: resultados.length,
    sinCorte: avisados,
    enviados,
    fallidos: avisados - enviados,
    resultados,
  });
}
