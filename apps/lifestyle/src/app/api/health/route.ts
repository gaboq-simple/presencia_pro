// ─── Health endpoint ──────────────────────────────────────────────────────────
// GET /api/health — sin autenticación. Usado por UptimeRobot / monitoreo externo.
// Responde 200 si todo ok, 503 si Supabase falla.

import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const checks = {
    timestamp: new Date().toISOString(),
    status: 'ok' as 'ok' | 'down',
    supabase: 'ok' as 'ok' | 'fail',
  };

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    checks.supabase = 'fail';
    checks.status   = 'down';
    return Response.json(checks, { status: 503 });
  }

  try {
    const supabase = createClient(url, key);
    const { error } = await supabase.from('businesses').select('id').limit(1);
    if (error) {
      checks.supabase = 'fail';
    }
  } catch {
    checks.supabase = 'fail';
  }

  if (checks.supabase === 'fail') {
    checks.status = 'down';
  }

  return Response.json(checks, {
    status: checks.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
