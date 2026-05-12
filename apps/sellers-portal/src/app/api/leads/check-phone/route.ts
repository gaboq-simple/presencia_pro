// ─── API /api/leads/check-phone ───────────────────────────────────────────────
// GET ?phone=XXX — verifica si un teléfono ya existe en cualquier vendedor.
// Usa service role para saltarse RLS — intencional, necesitamos ver todos los leads.

import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'No autorizado' }, { status: 401 });

  const phone = request.nextUrl.searchParams.get('phone');
  if (!phone) {
    return Response.json({ error: 'Falta el parámetro phone' }, { status: 400 });
  }

  // Guard: usa service role para buscar en TODOS los leads sin RLS
  const supabase = createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .eq('doctor_phone', phone)
    .limit(1)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ exists: data !== null });
}
