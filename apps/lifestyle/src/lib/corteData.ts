// ─── Corte de caja — capa de datos server (D5) ────────────────────────────────
// Las queries scopeadas que alimentan a `lib/corte.ts` (puro). Mismo reparto que
// cabos/cabosData y fuga/fugaData: la matemática no toca la BD y la BD no hace
// matemática.
//
// 🔴 SCOPE: `tenantDb` inyecta el business_id de la sesión.
// 🔴 A CIEGAS: nada de este módulo se expone al cliente antes de capturar el
//    conteo. `getInsumosDelCorte` lo llama SOLO la action, dentro del mismo
//    request que ya recibió los dos números — ver `caja-actions.ts`.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc } from '@/lib/dayWindow';
import type { CitaCobrada, MovimientoDelCorte } from '@/lib/corte';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

export type InsumosDelCorte = {
  citas:       CitaCobrada[];
  movimientos: MovimientoDelCorte[];
  fondo:       number;
};

type CitaRow = {
  price_charged:  number | string | null;
  payment_method: string | null;
  service:        { price: number | string } | null;
};

type MovRow = { type: string; amount: number | string; method: string };

/**
 * Todo lo que hace falta para calcular el esperado de un día LOCAL.
 *
 * **El día de caja de una cita es su `completed_at`**, no su `starts_at` (regla 1
 * de `lib/corte.ts`): el dinero cuenta cuando se cobró. Una cita agendada ayer y
 * cobrada hoy es de hoy, y una de las 19:00 cobrada a las 23:40 es de ese día.
 *
 * El monto es `price_charged` —el sellado al completar— con el precio de lista
 * como red para completadas legadas sin sello (mismo `COALESCE` que usan los
 * ingresos desde el fix de 2026-07-07; hoy son 0 filas en toda la BD).
 */
export async function getInsumosDelCorte(
  businessId: string,
  date: string,
  timezone: string,
): Promise<InsumosDelCorte> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);
  const { start, end } = localDayRangeUtc(date, timezone);

  const [citasRes, movsRes, bizRes] = await Promise.all([
    db
      .table('appointments')
      .select('price_charged, payment_method, service:service_id(price)')
      .eq('status', 'completed')
      .gte('completed_at', start)
      .lt('completed_at', end),
    db
      .table('caja_movimientos')
      .select('type, amount, method')
      .eq('occurred_on', date),
    // `businesses` es la raíz del tenant (no tiene business_id): se lee por id.
    supabase.from('businesses').select('caja_fondo').eq('id', businessId).maybeSingle(),
  ]);

  if (citasRes.error) throw new Error(`getInsumosDelCorte citas: ${citasRes.error.message}`);
  if (movsRes.error)  throw new Error(`getInsumosDelCorte movimientos: ${movsRes.error.message}`);

  const citas: CitaCobrada[] = ((citasRes.data ?? []) as unknown as CitaRow[]).map((r) => ({
    amount: Number(r.price_charged ?? r.service?.price ?? 0),
    // '' (y no null) para que el módulo puro lo cuente como "sin riel" sin tener
    // que saber de nulls de PostgREST.
    method: r.payment_method ?? '',
  }));

  const movimientos: MovimientoDelCorte[] = ((movsRes.data ?? []) as unknown as MovRow[]).map((r) => ({
    type:   r.type,
    amount: Number(r.amount),
    method: r.method,
  }));

  const fondo = Number((bizRes.data as { caja_fondo: number | string } | null)?.caja_fondo ?? 0);

  return { citas, movimientos, fondo };
}

// ─── Lectura de cortes ────────────────────────────────────────────────────────

export type CorteRow = {
  id:           string;
  corteDate:    string;
  createdAt:    string;
  replacesId:   string | null;
  cashCounted:  number;
  cardCounted:  number;
  expectedCash: number;
  expectedCard: number;
  fondoSnapshot: number;
  cashDiff:     number;
  cardDiff:     number;
  firmadoPor:   string;
  notifiedAt:   string | null;
  notifyError:  string | null;
};

type CorteDbRow = {
  id: string; corte_date: string; created_at: string; replaces_id: string | null;
  cash_counted: number | string; card_counted: number | string;
  expected_cash: number | string; expected_card: number | string;
  fondo_snapshot: number | string;
  cash_diff: number | string; card_diff: number | string;
  notified_at: string | null; notify_error: string | null;
  staff: { name: string } | null;
};

const SELECT_CORTE =
  'id, corte_date, created_at, replaces_id, cash_counted, card_counted, ' +
  'expected_cash, expected_card, fondo_snapshot, cash_diff, card_diff, ' +
  'notified_at, notify_error, staff:staff_id(name)';

function mapCorte(r: CorteDbRow): CorteRow {
  return {
    id:            r.id,
    corteDate:     r.corte_date,
    createdAt:     r.created_at,
    replacesId:    r.replaces_id,
    cashCounted:   Number(r.cash_counted),
    cardCounted:   Number(r.card_counted),
    expectedCash:  Number(r.expected_cash),
    expectedCard:  Number(r.expected_card),
    fondoSnapshot: Number(r.fondo_snapshot),
    cashDiff:      Number(r.cash_diff),
    cardDiff:      Number(r.card_diff),
    firmadoPor:    r.staff?.name ?? '—',
    notifiedAt:    r.notified_at,
    notifyError:   r.notify_error,
  };
}

/** Cortes desde una fecha local (inclusive), del más reciente al más viejo. */
export async function getCortesDesde(businessId: string, desde: string): Promise<CorteRow[]> {
  const { data, error } = await tenantDb(getServiceClient(), businessId)
    .table('caja_cortes')
    .select(SELECT_CORTE)
    .gte('corte_date', desde)
    .order('corte_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getCortesDesde failed: ${error.message}`);
  return ((data ?? []) as unknown as CorteDbRow[]).map(mapCorte);
}

/** Los cortes de UN día local (puede haber varios: corregir es fila nueva). */
export async function getCortesDelDia(businessId: string, date: string): Promise<CorteRow[]> {
  const { data, error } = await tenantDb(getServiceClient(), businessId)
    .table('caja_cortes')
    .select(SELECT_CORTE)
    .eq('corte_date', date)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getCortesDelDia failed: ${error.message}`);
  return ((data ?? []) as unknown as CorteDbRow[]).map(mapCorte);
}
