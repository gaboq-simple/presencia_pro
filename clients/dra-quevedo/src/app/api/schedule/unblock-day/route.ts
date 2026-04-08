// ─── API Route: POST /api/schedule/unblock-day ─────────────────────────────────
// Called by the doctor from the dashboard to remove a full-day block.
// Auth: active Supabase Auth session required (doctor-facing, not a cron).
// clientId always comes from clientConfig — never from the request body.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { unblockDay } from '@presenciapro/engine/scheduling';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';

// ─── Validation ────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  /** ISO date string — 'YYYY-MM-DD' or full ISO 8601. */
  date:         z.string().min(1),
  specialistId: z.string().min(1),
});

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
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

  // Parse + validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
  }

  const { date: dateStr, specialistId } = parsed.data;

  // Guard: specialistId must belong to this client
  const specialist = clientConfig.specialists.find((s) => s.id === specialistId);
  if (!specialist) {
    return json({ error: `Specialist not found: ${specialistId}` }, 404);
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return json({ error: `Invalid date: ${dateStr}` }, 400);
  }

  // Write with service role — doctor session verified above
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    await unblockDay({
      clientId:     clientConfig.client.id,
      specialistId,
      date,
      timezone:     clientConfig.client.timezone,
      supabase,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }

  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: clientConfig.client.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);

  return json({ unblocked: true, date: localDate }, 200);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
