// ─── GET /api/activity ────────────────────────────────────────────────────────
// Página siguiente del feed de actividad (audit) para el dashboard del dueño.
// SOLO lectura. Gateado a owner/admin — el asistente/barbero reciben 403 y no ven
// nada. business_id SIEMPRE del servidor (de la sesión); el cliente solo pasa el
// cursor `?before=<ISO>`.
//
// Query: ?before=<ISO created_at>  → los 50 eventos anteriores a ese instante.

import { NextRequest, NextResponse } from 'next/server';
import { requireOwnerOrAdmin } from '@/lib/auth';
import { getActivityFeed } from '@/lib/activityFeed';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const before = request.nextUrl.searchParams.get('before') ?? undefined;

  try {
    const page = await getActivityFeed(auth.businessId, before);
    return NextResponse.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
