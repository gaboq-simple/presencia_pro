// ─── API Route: POST /api/calendar/block-emergency ────────────────────────────
// Llamado por la Edge Function block-emergency-slots cada mañana a las 07:00.
// Bloquea los huecos de emergencia del día para todos los especialistas del cliente.
//
// Autenticación: header x-cron-secret debe coincidir con CRON_SECRET env var.
// Solo callable desde servidor — nunca exponer esta ruta al frontend.

import { createClient } from '@supabase/supabase-js';
import { blockEmergencySlots } from '@presenciapro/engine/scheduling';
import { clientConfig } from '@/config/client.config';

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockResult = {
  specialistId: string;
  ok: boolean;
  error?: string;
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
  const supabaseUrl      = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey   = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const googleClientId   = process.env['GOOGLE_CLIENT_ID'];
  const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const googleRefreshToken = process.env['GOOGLE_REFRESH_TOKEN'];

  if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleClientSecret || !googleRefreshToken) {
    console.error('[block-emergency] missing required env vars');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const credentials = {
    clientId:     googleClientId,
    clientSecret: googleClientSecret,
    refreshToken: googleRefreshToken,
  };

  // Parsear fecha del body — default: hoy
  let date: Date;
  try {
    const body = await request.json() as { date?: string };
    date = body.date ? new Date(body.date) : new Date();
  } catch {
    date = new Date();
  }

  const results: BlockResult[] = [];

  for (const specialist of clientConfig.specialists) {
    try {
      await blockEmergencySlots(
        {
          clientId:     clientConfig.client.id,
          specialistId: specialist.id,
          date,
        },
        {
          supabase,
          credentials,
          config: clientConfig,
        },
      );
      results.push({ specialistId: specialist.id, ok: true });
      console.log(`[block-emergency] blocked slots for ${specialist.id} on ${date.toISOString().slice(0, 10)}`);

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ specialistId: specialist.id, ok: false, error });
      console.error(`[block-emergency] failed for ${specialist.id}:`, error);
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
