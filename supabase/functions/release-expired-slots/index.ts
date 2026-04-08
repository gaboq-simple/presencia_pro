// ─── release-expired-slots ───────────────────────────────────────────────────
// Edge Function (Deno). Libera slots de citas en pending_confirmation cuya
// ventana de confirmación venció.
//
// Trigger: cron cada 5 minutos — configura en Supabase Dashboard → Edge Functions → Schedule
//   Cron: */5 * * * *
//
// Variables de entorno requeridas (Supabase Secrets):
//   SUPABASE_URL              — URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service role key (lee tabla clients)
//   CRON_SECRET               — token compartido con los API Routes de cada cliente
//
// Orquestador puro — no implementa lógica de negocio.
// La lógica de cancelación vive en /api/appointments/release-expired de cada cliente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabaseUrl    = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret     = Deno.env.get('CRON_SECRET');

  if (!supabaseUrl || !serviceRoleKey || !cronSecret) {
    return new Response(
      JSON.stringify({ error: 'missing env vars' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Leer clientes activos ─────────────────────────────────────────────────
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('active', true);

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const rows = (clients ?? []) as Array<{ id: string; domain: string }>;
  const results: Array<{ clientId: string; released?: number; error?: string }> = [];

  // ── Llamar a cada cliente ─────────────────────────────────────────────────
  for (const client of rows) {
    const url = `https://${client.domain}/api/appointments/release-expired`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cronSecret}`,
        },
      });

      if (res.ok) {
        const body = await res.json() as { released: number };
        results.push({ clientId: client.id, released: body.released });
      } else {
        results.push({ clientId: client.id, error: `HTTP ${res.status}` });
      }
    } catch (err) {
      // Un cliente fallido no bloquea los demás
      results.push({ clientId: client.id, error: String(err) });
    }
  }

  return new Response(
    JSON.stringify({ results }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
