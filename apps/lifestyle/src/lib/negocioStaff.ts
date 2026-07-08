// ─── Barberos (Negocio) — aggregator server ───────────────────────────────────
// Arma el bloque de recompra de héroe: carga barberos activos + sus visitas
// completadas ligadas a cliente, y delega la matemática al módulo puro
// (`staffRecompra`). No muta nada — lectura pura.
// 🔴 SCOPE Ola 1: businessId de la sesión del owner; cada query filtra por él.
// 🔴 NO reusa el proxy `recurring_clients` de S6 (≥2 visitas al negocio, agnóstico
//    del barbero): esta métrica es recompra AL barbero, otro cálculo al lado.

import { createClient } from '@supabase/supabase-js';
import {
  computeStaffRecompra,
  type CompletedVisit,
  type StaffRosterEntry,
  type StaffRecompraResult,
} from './staffRecompra';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

type RawVisitRow = { staff_id: string; customer_id: string; starts_at: string };

export async function getNegocioStaffRecompra(
  businessId: string,
  now: Date = new Date(),
): Promise<StaffRecompraResult> {
  const supabase = getServiceClient();

  // 1. Barberos activos del negocio (define filas y orden; incluye los de 0 data).
  const { data: staffData } = await supabase
    .from('staff')
    .select('id, name')
    .eq('business_id', businessId)
    .eq('role', 'barber')
    .eq('active', true);

  const roster: StaffRosterEntry[] = (staffData ?? []).map((s) => ({
    staffId: s.id as string,
    staffName: s.name as string,
  }));

  // Sin barberos → resultado vacío (el módulo puro degrada con gracia).
  if (roster.length === 0) {
    return computeStaffRecompra([], [], now.getTime());
  }

  // 2. Visitas completadas ligadas a cliente (customer_id NOT NULL) del negocio.
  //    staff_id es NOT NULL en el schema → la liga cita↔barbero nunca falta.
  const { data: apptData } = await supabase
    .from('appointments')
    .select('staff_id, customer_id, starts_at')
    .eq('business_id', businessId)
    .eq('status', 'completed')
    .not('customer_id', 'is', null);

  const visits: CompletedVisit[] = (apptData ?? []).map((r) => {
    const row = r as RawVisitRow;
    return { staffId: row.staff_id, customerId: row.customer_id, startsAt: row.starts_at };
  });

  return computeStaffRecompra(roster, visits, now.getTime());
}
