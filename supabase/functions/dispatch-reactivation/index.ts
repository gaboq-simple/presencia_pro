// ─── dispatch-reactivation ─────────────────────────────────────────────────────
// Edge Function (Deno). Orquesta el envío de mensajes de reactivación para
// todos los clientes activos.
//
// Trigger: cron lunes a las 10:00 hora de México
//   Cron: 0 16 * * 1   (16:00 UTC = 10:00 America/Mexico_City, UTC-6)
//   Nota: ajustar a 0 15 * * 1 durante horario de verano (UTC-5)
//
// Diseño:
//   La lógica de reactivación requiere ClientConfig (postConsulta.*) y
//   credenciales de WhatsApp — disponibles solo en el servidor Next.js de
//   cada cliente. Esta función actúa como orquestador: llama al endpoint
//   POST /api/notifications/reactivation de cada cliente activo y delega
//   la ejecución con credenciales locales. Sin lógica de negocio aquí.
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
  id:     string;
  name:   string;
  domain: string;
}

interface ReactivationResult {
  clientId: string;
  ok:       boolean;
  sent?:    number;
  status?:  number;
  error?:   string;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Fetch active clients ───────────────────────────────────────────────────
  const { data: clients, error: fetchError } = await supabase
    .from('clients')
    .select('id, name, domain')
    .eq('active', true);

  if (fetchError) {
    console.error('[dispatch-reactivation] fetch clients error:', fetchError.message);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  const results: ReactivationResult[] = [];

  for (const client of (clients as ClientRow[]) ?? []) {
    const endpoint = `https://${client.domain}/api/notifications/reactivation`;

    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[dispatch-reactivation] ${client.id} → ${res.status}: ${body}`);
        results.push({ clientId: client.id, ok: false, status: res.status });
      } else {
        const data = (await res.json()) as { sent: number };
        console.log(`[dispatch-reactivation] ${client.id} → OK (sent: ${data.sent})`);
        results.push({ clientId: client.id, ok: true, sent: data.sent });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[dispatch-reactivation] ${client.id} → fetch failed: ${errorMessage}`);
      results.push({ clientId: client.id, ok: false, error: errorMessage });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  const status = failed > 0 && results.every((r) => !r.ok) ? 500 : 200;

  console.log('[dispatch-reactivation] done', { total: results.length, failed });
  return new Response(JSON.stringify({ results }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
});
