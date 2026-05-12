// ─── Catálogo de servicios activos ────────────────────────────────────────────
// GET /api/catalog?businessId=[uuid]
//
// Devuelve los servicios activos del negocio. Cacheado con unstable_cache
// (TTL 300s, tag catalog-[businessId]) para reducir queries al bot.
//
// Invalidación: llamar revalidateTag(`catalog-${businessId}`) desde el
// Server Action o API Route que actualiza la tabla services.

import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ─── Query params schema ──────────────────────────────────────────────────────

const QuerySchema = z.object({
  businessId: z.string().uuid('businessId debe ser un UUID válido'),
});

// ─── DB row type ──────────────────────────────────────────────────────────────

type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  currency: string;
};

// ─── Cached fetcher ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(url, key);
}

function fetchActiveServices(businessId: string): Promise<ServiceRow[]> {
  return unstable_cache(
    async () => {
      const supabase = getServiceClient();

      const { data, error } = await supabase
        .from('services')
        .select('id, name, description, duration_minutes, price, currency')
        .eq('business_id', businessId)
        .eq('active', true)
        .order('name');

      if (error) throw new Error(`fetchActiveServices failed: ${error.message}`);
      return (data ?? []) as ServiceRow[];
    },
    [`catalog-${businessId}`],
    {
      revalidate: 300,
      tags: [`catalog-${businessId}`],
    },
  )();
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = QuerySchema.safeParse({
    businessId: request.nextUrl.searchParams.get('businessId'),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'businessId inválido' },
      { status: 400 },
    );
  }

  const { businessId } = parsed.data;

  const services = await fetchActiveServices(businessId);

  return NextResponse.json({ services });
}
