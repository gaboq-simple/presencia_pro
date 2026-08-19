// ─── analisisData — las lecturas nuevas de "Análisis" (dv3-6) ────────────────
// Server-only. Cuatro queries y ninguna más; los otros tres bloques de la pestaña
// reusan `negocioMetrics`, `negocioOccupancy` y `negocioStaff` sin cambios.
//
// 🔴 REGLA DURA (medida con EXPLAIN ANALYZE en la BD densa, no la re-discutas):
//    "citas del bot esta semana" filtra por **`starts_at`**, que está indexada
//    (`idx_appointments_business_starts`), NUNCA por `created_at`, que no lo
//    está — por ahí es un Seq Scan del histórico completo, 12.7 ms hoy y
//    creciendo con cada cita que el negocio agenda. Presupuesto del paso: ~2 ms
//    en total.
//
// Las ventanas son las del NEGOCIO: el mes y la semana locales, vía
// `getPeriodRange`, que es la misma función que usa el resto del dashboard. Un
// mes en UTC le sacaría al dueño las primeras seis horas de su día 1.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { getPeriodRange } from '@/lib/dashboard.types';
import { todayStrInTz } from '@/lib/dayWindow';
import {
  computeMezclaServicios, computeCanal, contarAtendidasPorEquipo,
  type ServicioMes, type MezclaServicios, type Canal, type CanalKey, type MensajeHumano,
} from '@/lib/analisis';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

/** Los tres números de la ventana al bot. Es el diferenciador del producto y hasta
 *  hoy el dueño no tenía dónde verlo: el bot trabajaba y no se notaba. */
export type VentanaBot = {
  conversaciones: number;
  citasDelBot:    number;
  /** Conversaciones DISTINTAS en las que respondió alguien del equipo esta semana. */
  atendidasPorEquipo: number;
};

export type AnalisisData = {
  servicios: MezclaServicios;
  canal:     Canal;
  bot:       VentanaBot;
  /** Etiqueta del mes en curso ("agosto") — el reloj de la pestaña, declarado. */
  mesLabel:  string;
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

type RawServicioRow = { service_id: string | null; price_charged: number | null; service: { name: string; price: number } | null };
type RawSourceRow   = { source: string };

export async function getAnalisis(businessId: string, timezone: string): Promise<AnalisisData> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);
  const hoy = todayStrInTz(timezone);
  const mes    = getPeriodRange('month', hoy, timezone);
  const semana = getPeriodRange('week',  hoy, timezone);

  const [svc, src, convs, citasBot, atendidas] = await Promise.all([
    // 1. Mezcla por servicio del mes — mismo ingreso sellado que el resto de la app.
    db.table('appointments')
      .select('service_id, price_charged, service:service_id(name, price)')
      .eq('status', 'completed')
      .gte('starts_at', mes.start).lt('starts_at', mes.end),

    // 2. Canal del mes: TODAS las citas del mes, no solo las completadas — la
    //    pregunta es de dónde VIENEN, y una que se canceló vino igual.
    db.table('appointments')
      .select('source')
      .gte('starts_at', mes.start).lt('starts_at', mes.end),

    // 3-5. La ventana al bot, semana local.
    db.table('bot_conversations')
      .select('id', { count: 'exact', head: true })
      .gte('last_message', semana.start),
    db.table('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'bot')
      .gte('starts_at', semana.start).lt('starts_at', semana.end),  // ← starts_at, ver 🔴
    // Atendidas por el equipo: se cuenta sobre los MENSAJES humanos, no sobre
    // `bot_conversations.taken_at`. `releaseConversation` pone `taken_at` en NULL,
    // así que ese conteo solo veía las conversaciones tomadas y TODAVÍA en manos
    // de una persona: devolverla al bot —el desenlace sano— la borraba del
    // número. Un mensaje enviado no se puede des-enviar; es el mismo patrón que
    // ya usa el reporte de uso (`api/reports/usage`, human_takeovers).
    // Se traen las filas y se deduplica en memoria (no hay COUNT DISTINCT en
    // PostgREST): son los mensajes humanos de UNA semana, decenas como mucho.
    db.table('conversation_messages')
      .select('customer_phone')
      .eq('sent_by', 'human')
      .gte('created_at', semana.start).lt('created_at', semana.end),
  ]);

  if (svc.error) throw new Error(`getAnalisis servicios: ${svc.error.message}`);
  if (src.error) throw new Error(`getAnalisis canal: ${src.error.message}`);
  if (atendidas.error) throw new Error(`getAnalisis atendidas: ${atendidas.error.message}`);

  // Agrupar por servicio. Sin embed no hay nombre ni precio de lista al que caer:
  // esa fila se omite en vez de inventarle un servicio "(sin nombre)".
  const porServicio = new Map<string, ServicioMes>();
  for (const row of (svc.data ?? []) as unknown as RawServicioRow[]) {
    if (!row.service_id || !row.service) continue;
    const acc = porServicio.get(row.service_id)
      ?? { serviceId: row.service_id, nombre: row.service.name, revenue: 0, citas: 0 };
    acc.revenue += row.price_charged ?? row.service.price;
    acc.citas   += 1;
    porServicio.set(row.service_id, acc);
  }

  const conteos: Record<CanalKey, number> = { bot: 0, manual: 0, walkin: 0 };
  for (const row of (src.data ?? []) as RawSourceRow[]) {
    if (row.source === 'bot' || row.source === 'manual' || row.source === 'walkin') {
      conteos[row.source] += 1;
    }
    // Otros valores del CHECK (p. ej. 'llamada') no entran a la apilada: son un
    // canal que la maqueta no contempla y meterlos sin color propio los haría
    // pasar por uno de los tres.
  }

  return {
    servicios: computeMezclaServicios([...porServicio.values()]),
    canal:     computeCanal(conteos),
    bot: {
      conversaciones:     convs.count ?? 0,
      citasDelBot:        citasBot.count ?? 0,
      atendidasPorEquipo: contarAtendidasPorEquipo((atendidas.data ?? []) as MensajeHumano[]),
    },
    mesLabel: MESES[Number(hoy.slice(5, 7)) - 1] ?? '',
  };
}
