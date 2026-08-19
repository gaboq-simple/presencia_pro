// ─── Server actions de la caja (D4 movimientos · D5 corte) ────────────────────
// Los movimientos fuera de agenda viven en su PROPIO módulo, no en
// `assistant-actions.ts`: eso es explícito en el plan y no es orden por el orden.
// `assistant-actions.ts` es el módulo de las CITAS (crear, mover, cancelar,
// cobrar) y la caja no es una cita — es la otra mitad del dinero, la que existe
// cuando no hubo agenda. Mezclarlas ataría cada cambio de una a releer la otra.
//
// Tres operaciones y ninguna más: registrar, anular (con contraentrada) y leer el
// día. NO hay editar ni borrar, por construcción: la tabla es append-only por
// trigger (decisión 10 del plan) — el UPDATE ni siquiera llega a la BD porque acá
// no existe la llamada.
//
// 🔴 SCOPE: todo pasa por `tenantDb` con el business_id de la SESIÓN. El actor
//    (`staff_id`) también sale de la sesión, nunca del cliente: una fila de dinero
//    sin autor confiable no sirve para nada de lo que viene después.

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { requireBusinessSession, getBusinessTimezone } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';
import { todayStrInTz } from '@/lib/dayWindow';
import {
  resolveMovimiento,
  esMovimientoError,
  type MovimientoInput,
  type MovimientoType,
} from '@/lib/caja';
import { expectedByRail, signedDiff, buildAvisoCorte } from '@/lib/corte';
import { getInsumosDelCorte, getCortesDelDia, type CorteRow } from '@/lib/corteData';
import { sendWhatsAppMeta } from '@presenciapro/engine/notifications';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Modelo que ve la UI ──────────────────────────────────────────────────────

export type MovimientoDelDia = {
  id:        string;
  type:      MovimientoType;
  concept:   string;
  amount:    number;
  method:    string;
  note:      string | null;
  /** Quién lo firmó. "—" si el staff ya no está (la fila sobrevive a la persona). */
  autor:     string;
  createdAt: string;
  /** Esta fila ANULA a otra (es la contraentrada). */
  reversesId: string | null;
  /** A esta fila la anularon: id de su contraentrada. Derivado en el server. */
  anuladoPorId: string | null;
};

type Row = {
  id:          string;
  type:        string;
  concept:     string;
  amount:      number | string;
  method:      string;
  note:        string | null;
  created_at:  string;
  reverses_id: string | null;
  staff:       { name: string } | null;
};

// ─── createCajaMovimiento ─────────────────────────────────────────────────────

/**
 * Registra dinero que no pasó por la agenda.
 *
 * `occurred_on` lo calcula el SERVER en la tz del negocio, nunca el cliente: un
 * walk-in de las 21:40 en México es 03:40Z del día siguiente, y pertenece al día
 * que lo cobró. Si el navegador mandara la fecha, un celular con la tz mal puesta
 * movería dinero de día y el corte de esa noche no cerraría nunca.
 */
export async function createCajaMovimiento(
  input: MovimientoInput,
): Promise<{ error?: string; id?: string }> {
  const auth = await requireBusinessSession();
  if (!auth.ok) return { error: auth.error };
  if (!auth.staffId) {
    // Toda sesión humana porta staff_id (PIN → directo; dueño por email → fila
    // staff vía auth_id). Si falta, no se inventa un autor: se dice.
    return { error: 'No se pudo identificar quién registra el movimiento' };
  }

  const mov = resolveMovimiento(input);
  if (esMovimientoError(mov)) return { error: mov.error };

  const timezone = await getBusinessTimezone(auth.businessId);
  const db = tenantDb(getServiceClient(), auth.businessId);

  const { data, error } = await db
    .table('caja_movimientos')
    .insert({
      type:        mov.type,
      amount:      mov.amount,
      method:      mov.method,
      concept:     mov.concept,
      note:        mov.note,
      staff_id:    auth.staffId,
      occurred_on: todayStrInTz(timezone),
    })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`createCajaMovimiento failed: ${error.message}`);

  revalidatePath('/staff');
  revalidatePath('/dashboard');
  return { id: (data as { id: string } | null)?.id };
}

// ─── reverseCajaMovimiento ────────────────────────────────────────────────────

/** El concepto de una contraentrada. `walkin`/`producto`/`insumos`/`retiro` no
 *  existen del otro lado del CHECK pareado, y forzar el concepto original sería
 *  mentir sobre el tipo: la contraentrada de una venta de producto no es una
 *  compra de producto. Es "otro" — la fila apunta a la que anula, y ahí está el
 *  qué. */
const CONCEPTO_CONTRAENTRADA = 'otro';

/**
 * Anula un movimiento con una CONTRAENTRADA: una fila nueva de tipo opuesto,
 * mismo monto y mismo riel, apuntando a la anulada. Jamás un UPDATE (el trigger
 * append-only lo bloquearía) y jamás un DELETE.
 *
 * Las dos filas quedan visibles y el neto del día vuelve a cero solo: cualquier
 * consumidor que haga `Σ entradas − Σ salidas` —el corte de D5, el cobrado de
 * D6— sale correcto sin saber que `reverses_id` existe.
 *
 * La contraentrada se fecha el día en que se ANULA, no el del movimiento
 * original: el pasado cerrado no se reescribe (decisión 10). En la práctica es
 * casi siempre el mismo día, porque la lista solo ofrece anular lo de hoy.
 */
export async function reverseCajaMovimiento(id: string): Promise<{ error?: string }> {
  const auth = await requireBusinessSession();
  if (!auth.ok) return { error: auth.error };
  if (!auth.staffId) {
    return { error: 'No se pudo identificar quién anula el movimiento' };
  }

  const db = tenantDb(getServiceClient(), auth.businessId);

  const { data: original, error: lookupError } = await db
    .table('caja_movimientos')
    .select('id, type, amount, method, reverses_id')
    .eq('id', id)
    .maybeSingle();

  if (lookupError) throw new Error(`reverseCajaMovimiento lookup failed: ${lookupError.message}`);
  if (!original) return { error: 'Ese movimiento no existe' };

  const row = original as { id: string; type: string; amount: number | string; method: string; reverses_id: string | null };

  // Una contraentrada no se anula: se anula lo que ella anuló, y eso ya pasó.
  if (row.reverses_id) return { error: 'Eso ya es una anulación' };

  // Pre-chequeo amable del UNIQUE de `reverses_id`: la BD lo impide igual (23505),
  // pero un "duplicate key value violates unique constraint" no es un mensaje.
  const { data: yaAnulado } = await db
    .table('caja_movimientos')
    .select('id')
    .eq('reverses_id', id)
    .maybeSingle();
  if (yaAnulado) return { error: 'Ese movimiento ya estaba anulado' };

  const timezone = await getBusinessTimezone(auth.businessId);

  const { error } = await db.table('caja_movimientos').insert({
    type:        row.type === 'entrada' ? 'salida' : 'entrada',
    amount:      Number(row.amount),
    method:      row.method,
    concept:     CONCEPTO_CONTRAENTRADA,
    note:        null,
    staff_id:    auth.staffId,
    reverses_id: row.id,
    occurred_on: todayStrInTz(timezone),
  });

  if (error) throw new Error(`reverseCajaMovimiento failed: ${error.message}`);

  revalidatePath('/staff');
  revalidatePath('/dashboard');
  return {};
}

// ─── listCajaDia ──────────────────────────────────────────────────────────────

/**
 * Movimientos de un día LOCAL del negocio, del más viejo al más nuevo (el orden
 * en que ocurrieron, que es como se lee un cajón).
 *
 * Sin `date` = hoy en la tz del negocio. La fecha es un filtro sobre
 * `occurred_on`, que ya es día local: no hace falta ventana UTC acá.
 */
export async function listCajaDia(date?: string): Promise<MovimientoDelDia[]> {
  const auth = await requireBusinessSession();
  if (!auth.ok) throw new Error(auth.error);

  const timezone = await getBusinessTimezone(auth.businessId);
  const dia = date ?? todayStrInTz(timezone);

  const { data, error } = await tenantDb(getServiceClient(), auth.businessId)
    .table('caja_movimientos')
    .select('id, type, concept, amount, method, note, created_at, reverses_id, staff:staff_id(name)')
    .eq('occurred_on', dia)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`listCajaDia failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Row[];
  // reverses_id apunta de la contraentrada a la anulada; la UI necesita la vuelta
  // (¿a esta fila la anularon?) para tacharla sin re-recorrer la lista por cada fila.
  const anuladoPor = new Map<string, string>();
  for (const r of rows) if (r.reverses_id) anuladoPor.set(r.reverses_id, r.id);

  return rows.map((r) => ({
    id:           r.id,
    type:         r.type as MovimientoType,
    concept:      r.concept,
    amount:       Number(r.amount),
    method:       r.method,
    note:         r.note,
    autor:        r.staff?.name ?? '—',
    createdAt:    r.created_at,
    reversesId:   r.reverses_id,
    anuladoPorId: anuladoPor.get(r.id) ?? null,
  }));
}

// ─── El corte a ciegas (D5) ───────────────────────────────────────────────────
// La verdad externa entra al sistema: dos números leídos de artefactos físicos
// (el efectivo del cajón, el voucher de la terminal) capturados A CIEGAS.
//
// 🔴 "A ciegas" acá no es una regla de la UI: es una propiedad de esta capa. NO
//    existe ninguna action que devuelva el esperado del día sin recibir el
//    conteo — `getInsumosDelCorte` solo se llama DENTRO de `createCorte`, en el
//    mismo request que ya trae los dos números. Aunque alguien llamara a las
//    server actions a mano desde la consola, no hay a quién preguntarle "¿cuánto
//    debería haber?" antes de comprometerse con una respuesta. Si el esperado
//    viajara antes, el conteo dejaría de ser un dato independiente y el
//    descuadre —lo único que esta capa produce— se volvería teatro.

/** Techo alineado con numeric(10,2), igual que el monto de un movimiento. */
const MAX_CONTEO = 99_999_999.99;

export type CorteCapturado = {
  cashCounted: number | string;
  cardCounted: number | string;
  /** Corregir un corte es una fila NUEVA que apunta a la anterior. */
  replacesId?: string | null;
};

export type CorteRevelado = {
  expectedCash:   number;
  expectedCard:   number;
  cashDiff:       number;
  cardDiff:       number;
  fondo:          number;
  /** Fuera de la comparación: no hay artefacto físico que contar. */
  transferencias: number;
  /** Cobrado sin riel registrado (filas legadas): no se reparte ni se adivina. */
  sinRiel:        number;
  firmadoPor:     string;
  at:             string;
  /** Resultado HONESTO del aviso al dueño: o llegó, o se dice por qué no. */
  avisoEntregado: boolean;
  avisoError:     string | null;
};

function parseConteo(v: number | string, etiqueta: string): number | { error: string } {
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/[$,\s]/g, ''));
  if (String(v).trim() === '' || !Number.isFinite(n)) return { error: `Falta el ${etiqueta}` };
  if (n < 0) return { error: `El ${etiqueta} no puede ser negativo` };
  if (n > MAX_CONTEO) return { error: `El ${etiqueta} es demasiado grande` };
  return Math.round(n * 100) / 100;
}

/**
 * Cierra el día: congela la foto del esperado EN ESTE INSTANTE, guarda el
 * descuadre con signo y le avisa al dueño.
 *
 * `expected_*` no se recalcula nunca más (es una columna, no una vista): si
 * mañana alguien completa una cita de hoy, el corte de hoy sigue diciendo lo que
 * se sabía cuando se contó. Esa es la diferencia entre un corte y un reporte.
 */
export async function createCorte(input: CorteCapturado): Promise<{ error?: string; corte?: CorteRevelado }> {
  const auth = await requireBusinessSession();
  if (!auth.ok) return { error: auth.error };
  if (!auth.staffId) return { error: 'No se pudo identificar quién firma el corte' };

  const cash = parseConteo(input.cashCounted, 'efectivo contado');
  if (typeof cash !== 'number') return cash;
  const card = parseConteo(input.cardCounted, 'total de la terminal');
  if (typeof card !== 'number') return card;

  const supabase = getServiceClient();
  const db = tenantDb(supabase, auth.businessId);

  // `businesses` es la RAÍZ del tenant: no tiene columna business_id, así que no
  // está en TENANT_TABLES ni la lint la guarda. Se lee por su propio id, que ya
  // viene de la sesión.
  const { data: bizRaw } = await supabase
    .from('businesses')
    .select('timezone, report_whatsapp, whatsapp_phone_number_id')
    .eq('id', auth.businessId)
    .maybeSingle();
  const biz = (bizRaw ?? {}) as {
    timezone: string | null;
    report_whatsapp: string | null;
    whatsapp_phone_number_id: string | null;
  };
  const timezone = biz.timezone ?? 'America/Mexico_City';
  const hoy = todayStrInTz(timezone);

  // Ya hay corte de hoy y no viene como corrección → se frena. Sin esto, dos
  // taps del mismo botón dejarían dos cortes del día sin relación entre ellos y
  // "la última fila manda" elegiría por hora, no por intención.
  const previos = await getCortesDelDia(auth.businessId, hoy);
  const vigente = previos[0];
  if (vigente && !input.replacesId) {
    return { error: 'Ya hay un corte de hoy. Para cambiarlo, usa "Corregir".' };
  }
  if (input.replacesId && !previos.some((c) => c.id === input.replacesId)) {
    return { error: 'Ese corte no es de hoy' };
  }

  const { citas, movimientos, fondo } = await getInsumosDelCorte(auth.businessId, hoy, timezone);
  const esperado = expectedByRail(citas, movimientos, fondo);
  const cashDiff = signedDiff(cash, esperado.efectivo);
  const cardDiff = signedDiff(card, esperado.tarjeta);

  const { data: creado, error } = await db
    .table('caja_cortes')
    .insert({
      corte_date:     hoy,
      staff_id:       auth.staffId,
      cash_counted:   cash,
      card_counted:   card,
      expected_cash:  esperado.efectivo,
      expected_card:  esperado.tarjeta,
      fondo_snapshot: fondo,
      replaces_id:    input.replacesId ?? null,
    })
    .select('id, created_at')
    .maybeSingle();

  if (error) throw new Error(`createCorte failed: ${error.message}`);
  const fila = creado as { id: string; created_at: string };

  // ── El aviso al dueño (decisión 3: le llega el MISMO día) ──────────────────
  // Fuera del try/catch del INSERT a propósito: el corte ya está guardado y es
  // válido aunque el aviso falle. Lo que NO se hace nunca es fingir que salió.
  const firmadoPor = await nombreDeStaff(supabase, auth.staffId);
  let avisoError: string | null = null;

  if (!biz.report_whatsapp) {
    avisoError = 'El negocio no tiene número de reportes configurado';
  } else if (!biz.whatsapp_phone_number_id) {
    avisoError = 'El negocio no tiene WhatsApp conectado';
  } else if (!process.env['WHATSAPP_ACCESS_TOKEN']) {
    avisoError = 'Falta WHATSAPP_ACCESS_TOKEN en el servidor';
  } else {
    try {
      const res = await sendWhatsAppMeta(
        {
          to: biz.report_whatsapp,
          body: buildAvisoCorte({
            cashCounted: cash, cardCounted: card, cashDiff, cardDiff,
            firmadoPor, at: fila.created_at, timeZone: timezone,
          }),
        },
        {
          accessToken: process.env['WHATSAPP_ACCESS_TOKEN']!,
          phoneNumberId: biz.whatsapp_phone_number_id,
        },
        { purpose: 'internal_ops' },   // el aviso del corte va al DUEÑO, no a un cliente
      );
      if (!res.success) avisoError = res.error ?? 'No se pudo enviar';
    } catch (e) {
      avisoError = e instanceof Error ? e.message : 'No se pudo enviar';
    }
  }

  // Las DOS únicas columnas mutables del corte (el trigger deja pasar solo
  // estas; cualquier otra las rebota).
  await db
    .table('caja_cortes')
    .update(avisoError ? { notify_error: avisoError.slice(0, 300) } : { notified_at: new Date().toISOString() })
    .eq('id', fila.id);

  revalidatePath('/staff');
  revalidatePath('/dashboard');

  return {
    corte: {
      expectedCash:   esperado.efectivo,
      expectedCard:   esperado.tarjeta,
      cashDiff,
      cardDiff,
      fondo:          esperado.fondo,
      transferencias: esperado.transferencias,
      sinRiel:        esperado.sinRiel,
      firmadoPor,
      at:             fila.created_at,
      avisoEntregado: avisoError === null,
      avisoError,
    },
  };
}

async function nombreDeStaff(supabase: ReturnType<typeof getServiceClient>, staffId: string): Promise<string> {
  // eslint-disable-next-line no-restricted-syntax -- lookup del propio actor por su id (ya server-derivado de la sesión); no hay dato de otro negocio que ver.
  const { data } = await supabase.from('staff').select('name').eq('id', staffId).maybeSingle();
  return (data as { name: string } | null)?.name ?? 'alguien del equipo';
}

/**
 * Los cortes de HOY para la card de captura (vacío = todavía no hubo corte).
 *
 * Devuelve cortes YA HECHOS: su `expected_*` es la foto congelada de un conteo
 * que ya ocurrió, no una pista de lo que va a salir. Antes del primer corte del
 * día esto devuelve `[]`, y no hay ninguna otra puerta al esperado.
 */
export async function getCortesDeHoy(): Promise<CorteRow[]> {
  const auth = await requireBusinessSession();
  if (!auth.ok) throw new Error(auth.error);
  const timezone = await getBusinessTimezone(auth.businessId);
  return getCortesDelDia(auth.businessId, todayStrInTz(timezone));
}
