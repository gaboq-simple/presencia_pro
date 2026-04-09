// ─── dispatch-monthly-report ───────────────────────────────────────────────────
// Edge Function (Deno). Dispara el reporte mensual para todos los clientes activos.
//
// Trigger: cron el día 1 de cada mes a las 10:00 UTC (04:00 CDMX, UTC-6)
//   Cron: 0 10 1 * *
//   Nota: ajustar a 0 9 1 * * durante horario de verano (UTC-5)
//
// Diseño (patrón orquestador — ARCHITECTURE.md sección 6.5):
//   La lógica de reporte requiere ClientConfig, credenciales de WhatsApp/Resend, y
//   acceso al engine de Next.js — todo disponible solo en el servidor del cliente.
//   Esta función actúa como orquestador: lee la tabla `clients` y llama al endpoint
//   POST /api/reports/monthly de cada cliente activo, delegando la ejecución.
//
// Variables de entorno requeridas (Supabase Secrets):
//   SUPABASE_URL              — URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasea RLS)
//   CRON_SECRET               — shared secret para autenticar llamadas al API route

import { createClient } from 'npm:@supabase/supabase-js@2';

// ─── Env ───────────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET               = Deno.env.get('CRON_SECRET')               ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  name: string;
  domain: string;
  timezone: string;
}

interface DispatchResult {
  clientId: string;
  ok: boolean;
  status?: number;
  error?: string;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Fetch active clients ───────────────────────────────────────────────────
  const { data: clients, error: fetchError } = await supabase
    .from('clients')
    .select('id, name, domain, timezone')
    .eq('active', true);

  if (fetchError) {
    console.error('[dispatch-monthly-report] fetch clients error:', fetchError.message);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  const results: DispatchResult[] = [];

  for (const client of (clients as ClientRow[]) ?? []) {
    const endpoint = `https://${client.domain}/api/reports/monthly`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'x-cron-secret': CRON_SECRET,
        },
        body: JSON.stringify({}),
        // Timeout: el API route puede tardar hasta 30s generando el reporte
        signal: AbortSignal.timeout(30_000),
      });

      const ok = res.ok;
      if (!ok) {
        const body = await res.text();
        console.error(`[dispatch-monthly-report] ${client.id} → ${res.status}: ${body}`);
      } else {
        console.log(`[dispatch-monthly-report] ${client.id} → OK`);
      }
      results.push({ clientId: client.id, ok, status: res.status });

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[dispatch-monthly-report] ${client.id} → fetch failed: ${errorMessage}`);
      results.push({ clientId: client.id, ok: false, error: errorMessage });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  const status = failed > 0 && results.every((r) => !r.ok) ? 500 : 200;

  console.log('[dispatch-monthly-report] done', { total: results.length, failed });
  return new Response(JSON.stringify({ results }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
});
