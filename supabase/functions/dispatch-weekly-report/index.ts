// ─── dispatch-weekly-report ───────────────────────────────────────────────────
// Edge Function (Deno). Orquestador del reporte semanal por WhatsApp.
//
// Patrón: orquestador liviano → delega lógica a POST /api/reports/weekly.
// Ver ARCHITECTURE-SHARED.md §4 — Patrón Orquestador.
//
// Schedule: lunes 10:00 AM UTC (04:00 CDMX)
//   Cron: 0 10 * * 1
//
// Por cada negocio activo con report_enabled = true:
//   POST {APP_URL}/api/reports/weekly
//     Authorization: Bearer {CRON_SECRET}
//     Body: { business_id }
//   Best-effort — fallo en un negocio no detiene los demás.
//
// Variables de entorno requeridas (Supabase Secrets):
//   SUPABASE_URL              — URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasea RLS)
//   CRON_SECRET               — token compartido con el API Route
//   APP_URL                   — URL base del app lifestyle
//                               (ej: https://lifestyle.presenciapro.com)

import { createClient } from 'npm:@supabase/supabase-js@2';

// ─── Env ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET               = Deno.env.get('CRON_SECRET')               ?? '';
const APP_URL                   = Deno.env.get('APP_URL')                   ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BusinessRow {
  id:   string;
  name: string;
}

interface DispatchResult {
  business_id: string;
  name:        string;
  status:      'ok' | 'error';
  error?:      string;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  if (!APP_URL) {
    console.error('[dispatch-weekly-report] APP_URL not set');
    return new Response(JSON.stringify({ error: 'APP_URL not configured' }), { status: 500 });
  }

  if (!CRON_SECRET) {
    console.error('[dispatch-weekly-report] CRON_SECRET not set');
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Obtener negocios activos con reportes habilitados ─────────────────────

  const { data: rows, error: fetchError } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('active', true)
    .eq('report_enabled', true);

  if (fetchError) {
    console.error('[dispatch-weekly-report] fetch businesses error:', fetchError.message);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  const businesses = (rows ?? []) as BusinessRow[];

  console.log(`[dispatch-weekly-report] processing ${businesses.length} businesses`);

  // ── Despachar en paralelo — best-effort por negocio ───────────────────────

  const results: DispatchResult[] = await Promise.all(
    businesses.map(async (biz): Promise<DispatchResult> => {
      try {
        const res = await fetch(`${APP_URL}/api/reports/weekly`, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${CRON_SECRET}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ business_id: biz.id }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body}`);
        }

        console.log(`[dispatch-weekly-report] ok — ${biz.name} (${biz.id})`);
        return { business_id: biz.id, name: biz.name, status: 'ok' };

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[dispatch-weekly-report] error — ${biz.name} (${biz.id}):`, message);
        return { business_id: biz.id, name: biz.name, status: 'error', error: message };
      }
    }),
  );

  const summary = {
    total:  results.length,
    ok:     results.filter((r) => r.status === 'ok').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  };

  console.log('[dispatch-weekly-report] done', { total: summary.total, ok: summary.ok, errors: summary.errors });

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
