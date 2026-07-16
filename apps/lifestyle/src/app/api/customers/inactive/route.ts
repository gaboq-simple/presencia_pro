// ─── GET /api/customers/inactive ──────────────────────────────────────────────
// Retorna clientes que no han visitado el negocio en N días.
//
// Query params:
//   threshold  — override de días (default: inactive_threshold_days del negocio)
//
// Auth: requiere sesión de owner o admin del negocio (token o Supabase Auth).
// business_id siempre del servidor — nunca del cliente.
//
// Tiers:
//   21–30 días → 'por_vencer'  (amarillo)
//   31–60 días → 'inactivo'    (naranja)
//   61+  días  → 'en_riesgo'   (rojo)
//
// Retorna InactiveClient[] ordenado por days_inactive ASC (más urgentes primero).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { requireOwnerOrAdmin } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';
import type { InactiveClient, InactiveClientTier } from '@/lib/dashboard.types';

// ─── Validación de input ──────────────────────────────────────────────────────

const QuerySchema = z.object({
  threshold: z
    .string()
    .regex(/^\d+$/, 'threshold must be a positive integer')
    .transform(Number)
    .refine((n) => n >= 1 && n <= 365, 'threshold must be between 1 and 365')
    .optional(),
});

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Shapes internos ──────────────────────────────────────────────────────────

type RawBusinessRow = {
  inactive_threshold_days: number;
};

type RawCustomerRow = {
  id: string;
  name: string;
  phone: string;
  visit_count: number;
  last_visit: string;    // TIMESTAMPTZ — last_visit IS NOT NULL (filtrado en query)
};

type RawLastApptRow = {
  customer_id: string;
  service: { name: string } | null;
  staff:   { name: string } | null;
};

// ─── Tier helper ─────────────────────────────────────────────────────────────

function computeTier(days: number): InactiveClientTier {
  if (days <= 30) return 'por_vencer';
  if (days <= 60) return 'inactivo';
  return 'en_riesgo';
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // 1. Auth: owner o admin del negocio (token o Supabase Auth)
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const businessId = auth.businessId;
  const supabase = getServiceClient();

  // 3. Validar query params
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    threshold: searchParams.get('threshold') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    // 4. Obtener threshold del negocio si no viene en el query param
    let threshold = parsed.data.threshold;

    if (threshold === undefined) {
      const { data: bizData, error: bizError } = await supabase
        .from('businesses')
        .select('inactive_threshold_days')
        .eq('id', businessId)
        .maybeSingle();

      if (bizError || !bizData) throw new Error('Business not found');

      threshold = (bizData as RawBusinessRow).inactive_threshold_days;
    }

    // 5. Fecha de corte
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - threshold);
    const cutoffIso = cutoff.toISOString();

    const now = new Date();

    // 6. Clientes con last_visit anterior al corte
    const db = tenantDb(supabase, businessId);
    const { data: custData, error: custError } = await db
      .table('customers')
      .select('id, name, phone, visit_count, last_visit')
      .not('last_visit', 'is', null)
      .lt('last_visit', cutoffIso)
      .order('last_visit', { ascending: true });   // más antiguos primero

    if (custError) throw new Error(`customers query: ${custError.message}`);

    const customers = (custData ?? []) as RawCustomerRow[];

    if (customers.length === 0) {
      return NextResponse.json([] as InactiveClient[]);
    }

    const customerIds = customers.map((c) => c.id);

    // 7. Última cita completada por cliente (para last_service y last_staff)
    //    Una query por negocio — filtramos por customer_ids en memoria.
    //    Usamos max(starts_at) implícitamente ordenando DESC y tomando la primera
    //    aparición de cada customer_id.
    const { data: apptData, error: apptError } = await db
      .table('appointments')
      .select('customer_id, service:service_id(name), staff:staff_id(name)')
      .in('customer_id', customerIds)
      .eq('status', 'completed')
      .order('starts_at', { ascending: false });

    if (apptError) throw new Error(`appointments query: ${apptError.message}`);

    // Tomar la primera fila por customer_id (la más reciente)
    const lastApptMap = new Map<string, RawLastApptRow>();
    for (const row of (apptData ?? []) as unknown as RawLastApptRow[]) {
      if (row.customer_id && !lastApptMap.has(row.customer_id)) {
        lastApptMap.set(row.customer_id, row);
      }
    }

    // 8. Construir InactiveClient[]
    const result: InactiveClient[] = customers.map((c) => {
      const lastVisitDate = new Date(c.last_visit);
      const days_inactive = Math.floor(
        (now.getTime() - lastVisitDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      const lastAppt = lastApptMap.get(c.id);

      return {
        customer_id: c.id,
        name:         c.name,
        phone:        c.phone,
        days_inactive,
        last_service: lastAppt?.service?.name ?? null,
        last_staff:   lastAppt?.staff?.name   ?? null,
        visit_count:  c.visit_count,
        tier:         computeTier(days_inactive),
      };
    });

    // Ordenar por days_inactive ASC (más urgentes = menos días primero)
    result.sort((a, b) => a.days_inactive - b.days_inactive);

    return NextResponse.json(result);
  } catch (err) {
    // TODO (M-3 — fuga de mensajes de error): err.message puede revelar nombres
    // de tablas o columnas. En producción retornar mensaje genérico.
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[customers/inactive]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
