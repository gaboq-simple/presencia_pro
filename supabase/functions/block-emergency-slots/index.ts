// ─── block-emergency-slots ─────────────────────────────────────────────────────
// Edge Function (Deno). Bloquea los huecos de emergencia del día para todos los
// clientes activos.
//
// Trigger: cron cada día hábil a las 07:00 hora de México
//   Cron: 0 13 * * 1-5   (13:00 UTC = 07:00 America/Mexico_City, UTC-6)
//   Nota: ajustar a 0 12 * * 1-5 durante horario de verano (UTC-5)
//
// Diseño:
//   La lógica de bloqueo (blockEmergencySlots) requiere ClientConfig completo
//   y credenciales de Google Calendar — ambos disponibles solo en el contexto
//   del servidor Next.js de cada cliente. Esta función actúa como orquestador:
//   llama al endpoint POST /api/calendar/block-emergency de cada cliente activo
//   y delega la ejecución con credenciales locales.
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

interface BlockResult {
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
    console.error('[block-emergency-slots] fetch clients error:', fetchError.message);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  const results: BlockResult[] = [];

  for (const client of (clients as ClientRow[]) ?? []) {
    // Compute today's date in the client's timezone
    const todayLocal = new Intl.DateTimeFormat('sv-SE', {
      timeZone: client.timezone,
    }).format(new Date());  // sv-SE gives YYYY-MM-DD format

    const endpoint = `https://${client.domain}/api/calendar/block-emergency`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'x-cron-secret': CRON_SECRET,
        },
        body: JSON.stringify({ date: `${todayLocal}T07:00:00` }),
        // Timeout: Edge Functions tienen 2 min de límite — el API route debe completar en < 30s
        signal: AbortSignal.timeout(30_000),
      });

      const ok = res.ok;
      if (!ok) {
        const body = await res.text();
        console.error(`[block-emergency-slots] ${client.id} → ${res.status}: ${body}`);
      } else {
        console.log(`[block-emergency-slots] ${client.id} → OK`);
      }
      results.push({ clientId: client.id, ok, status: res.status });

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[block-emergency-slots] ${client.id} → fetch failed: ${errorMessage}`);
      results.push({ clientId: client.id, ok: false, error: errorMessage });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  const status = failed > 0 && results.every((r) => !r.ok) ? 500 : 200;

  console.log('[block-emergency-slots] done', { total: results.length, failed });
  return new Response(JSON.stringify({ results }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
});
