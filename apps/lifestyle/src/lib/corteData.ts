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
import { localDayRangeUtc, todayStrInTz } from '@/lib/dayWindow';
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

/**
 * Los cobros del día que NADIE declaró cómo se pagaron: el DESGLOSE del cubo
 * `sinRiel` que el corte ya cuenta como un número (D5 + S9-OPS-06).
 *
 * **Vive pegado a `getInsumosDelCorte` a propósito y comparte su predicado
 * exacto**: `status='completed'` + `completed_at` dentro del día LOCAL. Si esta
 * lista usara `starts_at` —que es por donde la mesa arma su día— mostraría un
 * conjunto DISTINTO del que el corte cuenta: una cita de ayer cobrada hoy es del
 * corte de hoy y no aparece en la agenda de hoy. Dos verdades del mismo día es
 * justo lo que la capa de dinero existió para volver imposible, así que el
 * predicado se escribe una vez y las dos funciones lo leen del mismo lugar.
 *
 * NO devuelve un subtotal, y eso es deliberado: el monto de CADA cobro hace
 * falta para reconocerlo (y ya se ve en la ficha y en la lista de caja), pero la
 * SUMA sería un pedazo del esperado del día antes de contarlo. El corte es a
 * ciegas.
 */
export type CobroSinRiel = {
  id:          string;
  cliente:     string | null;
  monto:       number;
  /** ISO del cierre — la UI lo rinde en la tz del negocio. */
  completadoAt: string | null;
};

export async function getCobrosSinRiel(
  businessId: string,
  date: string,
  timezone: string,
): Promise<CobroSinRiel[]> {
  const { start, end } = localDayRangeUtc(date, timezone);

  const { data, error } = await tenantDb(getServiceClient(), businessId)
    .table('appointments')
    .select('id, price_charged, completed_at, customer:customer_id(name), service:service_id(price)')
    .eq('status', 'completed')
    .is('payment_method', null)
    .gte('completed_at', start)
    .lt('completed_at', end)
    .order('completed_at', { ascending: true });

  if (error) throw new Error(`getCobrosSinRiel failed: ${error.message}`);

  type Row = {
    id: string;
    price_charged: number | string | null;
    completed_at: string | null;
    customer: { name: string } | null;
    service: { price: number | string } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id:      r.id,
    cliente: r.customer?.name ?? null,
    // Mismo COALESCE que `getInsumosDelCorte`: el sellado, con la lista como red
    // para completadas legadas sin sello.
    monto:   Number(r.price_charged ?? r.service?.price ?? 0),
    completadoAt: r.completed_at,
  }));
}

/**
 * Los insumos de un RANGO de días locales, ya etiquetados con su día.
 *
 * Es `getInsumosDelCorte` estirado: **el mismo predicado** —citas `completed`
 * atribuidas por `completed_at`, movimientos por `occurred_on`— sobre una ventana
 * de varios días en vez de uno. Vive pegado a él a propósito: si el período
 * usara `starts_at`, o contara las citas de otra manera, la semana y el día
 * dirían números distintos del mismo negocio.
 *
 * El día local de cada cita se calcula con `todayStrInTz(tz, instante)` — la
 * MISMA función que decide qué día es hoy, con su `now` inyectable. No hace falta
 * un conversor nuevo, y usar el mismo evita que dos definiciones de "día local"
 * se separen con el tiempo.
 */
export type InsumosDelRango = {
  citas:       { fecha: string; amount: number }[];
  movimientos: { fecha: string; type: string; amount: number }[];
  /** Días de la semana (0=domingo) con horario activo. Vacío = sin horarios cargados. */
  diasAbiertos: number[];
};

export async function getInsumosDelRango(
  businessId: string,
  desde: string,
  hasta: string,
  timezone: string,
): Promise<InsumosDelRango> {
  const db = tenantDb(getServiceClient(), businessId);
  const { start } = localDayRangeUtc(desde, timezone);
  const { end }   = localDayRangeUtc(hasta, timezone);

  // `staff_availability` NO tiene business_id (su aislamiento es transitivo por
  // staff_id, contrato de `tenantDb`): se acota con los ids del negocio, que sí
  // salen de una query scopeada. Mismo procedimiento que `semanaHero`.
  const { data: staffRows } = await db.table('staff').select('id').eq('active', true);
  const staffIds = ((staffRows ?? []) as unknown as { id: string }[]).map((x) => x.id);

  const [citasRes, movsRes, availRes] = await Promise.all([
    db.table('appointments')
      .select('price_charged, completed_at, service:service_id(price)')
      .eq('status', 'completed')
      .gte('completed_at', start)
      .lt('completed_at', end),
    db.table('caja_movimientos')
      .select('type, amount, occurred_on')
      .gte('occurred_on', desde)
      .lte('occurred_on', hasta),
    staffIds.length === 0
      ? Promise.resolve({ data: [] as unknown[] })
      : getServiceClient().from('staff_availability').select('day_of_week')
          .in('staff_id', staffIds).eq('is_active', true),
  ]);

  if (citasRes.error) throw new Error(`getInsumosDelRango citas: ${citasRes.error.message}`);
  if (movsRes.error)  throw new Error(`getInsumosDelRango movimientos: ${movsRes.error.message}`);

  type CitaRangoRow = { price_charged: number | string | null; completed_at: string; service: { price: number | string } | null };
  type MovRangoRow  = { type: string; amount: number | string; occurred_on: string };

  const diasAbiertos = [...new Set(
    ((availRes.data ?? []) as unknown as { day_of_week: number }[]).map((a) => a.day_of_week),
  )];

  return {
    diasAbiertos,
    citas: ((citasRes.data ?? []) as unknown as CitaRangoRow[]).map((r) => ({
      fecha:  todayStrInTz(timezone, new Date(r.completed_at)),
      // Mismo COALESCE que el corte: el sellado, con la lista como red.
      amount: Number(r.price_charged ?? r.service?.price ?? 0),
    })),
    movimientos: ((movsRes.data ?? []) as unknown as MovRangoRow[]).map((r) => ({
      fecha:  r.occurred_on,
      type:   r.type,
      amount: Number(r.amount),
    })),
  };
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
  /** Cobrado del día cuyo riel nadie declaró. Congelado, y FUERA de los dos
   *  esperados a propósito: no hay artefacto físico contra el cual contarlo. */
  sinRiel:      number;
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
  sin_riel_snapshot: number | string;
  cash_diff: number | string; card_diff: number | string;
  notified_at: string | null; notify_error: string | null;
  staff: { name: string } | null;
};

const SELECT_CORTE =
  'id, corte_date, created_at, replaces_id, cash_counted, card_counted, ' +
  'expected_cash, expected_card, fondo_snapshot, sin_riel_snapshot, cash_diff, card_diff, ' +
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
    sinRiel:       Number(r.sin_riel_snapshot),
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
