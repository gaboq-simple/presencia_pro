// ─── API Route: GET /api/schedule/blocked-days ─────────────────────────────────
// Returns all blocked days for a specialist in a given month.
// Used by BlockedDaysManager to render the calendar state.
//
// Query params: specialistId, year (YYYY), month (1–12)
// Auth: active Supabase Auth session required.

import { createClient } from '@supabase/supabase-js';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';

export async function GET(request: Request): Promise<Response> {
  // Guard: feature is medical-only
  if (!isMedical(clientConfig)) {
    return json({ error: 'Not available for this profile' }, 403);
  }

  // Guard: required env vars
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey        = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server configuration error' }, 500);
  }

  // Guard: active doctor session
  const authHeader = request.headers.get('Authorization') ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Parse query params
  const { searchParams } = new URL(request.url);
  const specialistId = searchParams.get('specialistId');
  const yearStr      = searchParams.get('year');
  const monthStr     = searchParams.get('month');

  if (!specialistId || !yearStr || !monthStr) {
    return json({ error: 'Missing query params: specialistId, year, month' }, 400);
  }

  const year  = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1–12

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return json({ error: 'Invalid year or month' }, 400);
  }

  // Guard: specialistId must belong to this client
  const specialist = clientConfig.specialists.find((s) => s.id === specialistId);
  if (!specialist) {
    return json({ error: `Specialist not found: ${specialistId}` }, 404);
  }

  // Build date range for the month — 'YYYY-MM-DD' strings
  const pad  = (n: number) => String(n).padStart(2, '0');
  const from = `${year}-${pad(month)}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const to   = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await supabase
    .from('blocked_days')
    .select('date, reason')
    .eq('client_id', clientConfig.client.id)
    .eq('specialist_id', specialistId)
    .gte('date', from)
    .lte('date', to)
    .order('date');

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ dates: data ?? [] }, 200);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
