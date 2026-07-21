// ─── GET /api/reports/summary ─────────────────────────────────────────────────
// Retorna métricas agregadas para un período dado, de la sucursal de la sesión.
//
// Query params:
//   period — 'day' | 'week' | 'month'
//   date   — 'YYYY-MM-DD' (día ancla del período)
//
// Auth: requiere sesión activa (ls_session o Supabase Auth) con role owner/admin.
// El business_id sale SIEMPRE de la sesión (el multi-sucursal consolidado murió con
// el token de organización).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentSession } from '@/lib/auth';
import { getPeriodMetrics } from '@/lib/dashboard.types';

// ─── Validación de input ──────────────────────────────────────────────────────

const QuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .refine((s) => !isNaN(Date.parse(`${s}T12:00:00`)), 'date is not valid'),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // 1. Verificar sesión (ls_session o Supabase Auth)
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Solo owner / admin pueden ver métricas (incluyen revenue del negocio).
  // El asistente y el barbero NO ven el dinero — igual que staff-metrics/usage.
  const ALLOWED = ['owner', 'admin'] as const;
  if (!ALLOWED.includes(session.role as typeof ALLOWED[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Validar query params con Zod
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    period: searchParams.get('period'),
    date: searchParams.get('date'),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { period, date } = parsed.data;

  // 3. business_id de la sesión (siempre una sucursal; el multi-sucursal consolidado
  //    murió con el token de organización).
  try {
    const metrics = await getPeriodMetrics(session.business_id, period, date);
    return NextResponse.json(metrics);
  } catch (err) {
    // TODO (M-3 — fuga de mensajes de error): err.message puede revelar nombres
    // de tablas o columnas de Supabase. En producción, loguear internamente y
    // retornar mensaje genérico: return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[reports/summary]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
