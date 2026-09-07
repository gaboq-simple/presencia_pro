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
import { sumarDias } from '@/lib/timeWindows';
import { calcularAtajos, ordenDelCatalogo, type AtajosDeCaja, type MovimientoHistorico } from '@/lib/atajosCaja';
import {
  estadoDelFijo, ordenarEstados, ultimosPagosVigentes, CADENCIAS,
  type Fijo, type EstadoFijo, type Cadencia, type PagoDeFijo,
} from '@/lib/fijos';
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

// ─── getAtajosDeCaja (M3) ─────────────────────────────────────────────────────

/** Ventana del histórico que ordena los chips. Un mes es lo que tarda un negocio
 *  en mostrar su patrón sin arrastrar el de la temporada pasada. */
const DIAS_DE_HISTORIA = 30;

/**
 * El orden de los conceptos y los montos frecuentes, calculados con las PROPIAS
 * filas del negocio.
 *
 * El catálogo de salidas creció a 7 conceptos (M3) para dejar de registrar la
 * renta como un retiro. Más opciones no cuestan taps —sigue siendo una— pero sí
 * cuestan lectura, y un catálogo que se lee lento no molesta: hace que la gente
 * deje de registrar. Esto lo compensa sin quitarle opciones a nadie: solo
 * reordena, y el catálogo sale siempre completo.
 *
 * Si la lectura falla, se devuelve el orden del catálogo. Un atajo es una
 * comodidad: que se caiga NO puede impedir registrar un movimiento.
 */
export async function getAtajosDeCaja(): Promise<AtajosDeCaja> {
  const vacio: AtajosDeCaja = { orden: ordenDelCatalogo(), montos: {} };

  const auth = await requireBusinessSession();
  if (!auth.ok) return vacio;

  // `occurred_on` YA es día local del negocio, así que acá no hace falta una
  // ventana UTC: hace falta aritmética de calendario sobre 'YYYY-MM-DD', y de eso
  // se encarga `sumarDias`. Armarla con `Date`/`UTC` crudo es justo lo que el
  // repo-check de `timeWindows` prohíbe — y lo cazó en la primera corrida de este
  // paso, sobre este mismo bloque.
  const timezone = await getBusinessTimezone(auth.businessId);
  const desde = sumarDias(todayStrInTz(timezone), -DIAS_DE_HISTORIA);

  const { data, error } = await tenantDb(getServiceClient(), auth.businessId)
    .table('caja_movimientos')
    .select('id, type, concept, amount, reverses_id')
    .gte('occurred_on', desde);

  if (error) return vacio;

  type HistRow = { id: string; type: string; concept: string; amount: number | string; reverses_id: string | null };
  const historico: MovimientoHistorico[] = ((data ?? []) as unknown as HistRow[]).map((r) => ({
    id:         r.id,
    type:       r.type,
    concept:    r.concept,
    amount:     Number(r.amount),
    reversesId: r.reverses_id,
  }));

  return calcularAtajos(historico);
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
      // Lo cobrado sin riel declarado se CONGELA como los dos esperados
      // (S9-OPS-06). Antes viajaba sólo en la respuesta y se evaporaba al
      // recargar; ahora es parte del registro del corte, con su nombre y fuera
      // de la comparación —no hay artefacto físico contra el cual contarlo—.
      sin_riel_snapshot: esperado.sinRiel,
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

// ─── Gastos fijos (M4 de S10-ASIS-01) ─────────────────────────────────────────
// UN FIJO NUNCA SE REGISTRA SOLO. No hay cron, no hay job y no hay trigger que
// inserte movimientos: un fijo VENCE, aparece en la cola del día y una persona lo
// confirma con un tap. Ese gesto —y solo ese— escribe en `caja_movimientos`.
//
// La razón es la regla dura de `CLAUDE.md`: un movimiento AFIRMA un hecho del
// mundo, y escribir "salió la renta" porque es día 3 es fabricar evidencia. Un
// mes se paga el 5, otro no se paga, y el sistema no tiene forma de saberlo.
//
// Y es también la respuesta a la objeción que originó el diseño: un recurrente
// que se configura una vez y desaparece es peor que anotarlo a mano. Este vuelve
// a tocar la puerta cada período, así que no se puede olvidar — y el monto llega
// editable en el mismo lugar donde uno se da cuenta de que subió.

// NO se re-exporta `EstadoFijo` desde acá. En un módulo `'use server'` TODO export
// tiene que ser una función async, y Turbopack convierte el `export type` en un
// re-export de VALOR que revienta en runtime con `ReferenceError`. `tsc` no lo ve
// —para él es un tipo y se borra—, así que lo caza la ruta real o nadie.
// Pasó en M2 con `CobroSinRiel`, quedó escrito, y volvió a pasar acá: por eso M4
// deja el repo-check `useServerExports.repo.test.ts`, que ahora sí lo impide.
// Quien necesite el tipo lo importa de `@/lib/fijos` con `import type`.

type FijoRow = {
  id: string; concept: string; label: string;
  amount_sugerido: number | string; method_sugerido: string;
  cadencia: string; dia_del_mes: number | null; dia_de_semana: number | null;
  active: boolean;
};

/**
 * Los fijos del negocio con su estado: cuándo vencen, si están pendientes y
 * cuánto se pagó la última vez.
 *
 * **El último pago se DERIVA de los movimientos** (`fijo_id`), no de una columna
 * de `caja_fijos`. Una fecha guardada exige a alguien que la mueva, y el día que
 * nadie la mueva la tabla miente en silencio; los movimientos, en cambio, son el
 * hecho.
 */
export async function listarFijos(soloActivos = true): Promise<EstadoFijo[]> {
  const auth = await requireBusinessSession();
  if (!auth.ok) throw new Error(auth.error);

  const timezone = await getBusinessTimezone(auth.businessId);
  const hoy = todayStrInTz(timezone);
  const db = tenantDb(getServiceClient(), auth.businessId);

  let q = db.table('caja_fijos').select(
    'id, concept, label, amount_sugerido, method_sugerido, cadencia, dia_del_mes, dia_de_semana, active',
  );
  if (soloActivos) q = q.eq('active', true);

  const { data, error } = await q;
  if (error) throw new Error(`listarFijos failed: ${error.message}`);

  const fijos: Fijo[] = ((data ?? []) as unknown as FijoRow[]).map((r) => ({
    id:             r.id,
    label:          r.label,
    concept:        r.concept,
    amountSugerido: Number(r.amount_sugerido),
    methodSugerido: r.method_sugerido,
    cadencia:       r.cadencia as Cadencia,
    diaDelMes:      r.dia_del_mes,
    diaDeSemana:    r.dia_de_semana,
    active:         r.active,
  }));
  if (fijos.length === 0) return [];

  // Los pagos de todos los fijos, del más nuevo al más viejo.
  const { data: pagos, error: errPagos } = await db
    .table('caja_movimientos')
    .select('id, fijo_id, amount, occurred_on')
    .in('fijo_id', fijos.map((f) => f.id))
    .is('reverses_id', null)   // una contraentrada no es un pago
    .order('occurred_on', { ascending: false });

  if (errPagos) throw new Error(`listarFijos pagos: ${errPagos.message}`);

  type PagoRow = { id: string; fijo_id: string; amount: number | string; occurred_on: string };
  const candidatos: PagoDeFijo[] = ((pagos ?? []) as unknown as PagoRow[]).map((p) => ({
    id: p.id, fijoId: p.fijo_id, occurredOn: p.occurred_on, amount: Number(p.amount),
  }));

  // ¿Alguno de esos pagos fue ANULADO? La contraentrada NO lleva `fijo_id`
  // (`reverseCajaMovimiento` no lo copia), así que hay que preguntarle por
  // `reverses_id` — que además es UNIQUE, o sea indexado. Sin este paso un pago
  // anulado seguiría contando como pagado y el fijo se quedaría CALLADO todo el
  // período sin que nadie haya pagado nada: justo el modo de fallo que M4 evita.
  const anulados = new Set<string>();
  if (candidatos.length > 0) {
    const { data: contras, error: errContras } = await db
      .table('caja_movimientos')
      .select('reverses_id')
      .in('reverses_id', candidatos.map((c) => c.id));
    if (errContras) throw new Error(`listarFijos anulaciones: ${errContras.message}`);
    for (const c of (contras ?? []) as unknown as { reverses_id: string }[]) {
      anulados.add(c.reverses_id);
    }
  }

  const ultimo = ultimosPagosVigentes(candidatos, anulados);
  return ordenarEstados(fijos.map((f) => estadoDelFijo(f, ultimo.get(f.id) ?? null, hoy)));
}

export type FijoInput = {
  concept: string;
  label: string;
  amount: number | string;
  method: string;
  cadencia: string;
  diaDelMes?: number | null;
  diaDeSemana?: number | null;
};

/**
 * Declara un fijo. **No es dinero**: es una intención —cuánto suele ser, cada
 * cuánto, con qué riel—, así que crearlo no afirma nada sobre el mundo y no toca
 * `caja_movimientos`.
 */
export async function crearFijo(input: FijoInput): Promise<{ error?: string; id?: string }> {
  const auth = await requireBusinessSession();
  if (!auth.ok) return { error: auth.error };
  if (!auth.staffId) return { error: 'No se pudo identificar quién declara el fijo' };

  const label = (input.label ?? '').trim();
  if (label.length === 0 || label.length > 60) return { error: 'Ponle un nombre corto al fijo' };

  // El monto se valida con el MISMO módulo puro que un movimiento: es el mismo
  // techo, la misma coma decimal y el mismo mensaje en el mismo idioma.
  const comoMovimiento = resolveMovimiento({
    type: 'salida', concept: input.concept, amount: input.amount, method: input.method,
  });
  if (esMovimientoError(comoMovimiento)) return { error: comoMovimiento.error };

  if (!(CADENCIAS as readonly string[]).includes(input.cadencia)) {
    return { error: 'Cadencia no válida' };
  }
  const mensual = input.cadencia === 'mensual';
  const diaDelMes = mensual ? Number(input.diaDelMes) : null;
  const diaDeSemana = mensual ? null : Number(input.diaDeSemana);
  if (mensual && !(diaDelMes! >= 1 && diaDelMes! <= 31)) return { error: 'Elige un día del mes (1 a 31)' };
  if (!mensual && !(diaDeSemana! >= 0 && diaDeSemana! <= 6)) return { error: 'Elige un día de la semana' };

  const { data, error } = await tenantDb(getServiceClient(), auth.businessId)
    .table('caja_fijos')
    .insert({
      concept:         comoMovimiento.concept,
      label,
      amount_sugerido: comoMovimiento.amount,
      method_sugerido: comoMovimiento.method,
      cadencia:        input.cadencia,
      dia_del_mes:     diaDelMes,
      dia_de_semana:   diaDeSemana,
      created_by:      auth.staffId,
    })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`crearFijo failed: ${error.message}`);
  revalidatePath('/dashboard');
  return { id: (data as { id: string } | null)?.id };
}

/** Se desactiva, no se borra: los movimientos que ya apuntan a él tienen que
 *  poder seguir explicando de dónde salieron. */
export async function desactivarFijo(id: string): Promise<{ error?: string }> {
  const auth = await requireBusinessSession();
  if (!auth.ok) return { error: auth.error };

  const { error } = await tenantDb(getServiceClient(), auth.businessId)
    .table('caja_fijos')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(`desactivarFijo failed: ${error.message}`);
  revalidatePath('/dashboard');
  return {};
}

/**
 * Confirma que un fijo SE PAGÓ: escribe el movimiento real, firmado por quien lo
 * confirma. Este es el ÚNICO camino por el que un fijo produce plata.
 *
 * Si el monto confirmado es distinto del sugerido, la plantilla se actualiza: el
 * ajuste ocurre donde la persona se dio cuenta de que subió, no en un menú de
 * configuración que habría que recordar que existe. El movimiento guarda lo que
 * se pagó DE VERDAD; la plantilla, lo que probablemente se pague la próxima.
 */
export async function confirmarFijo(
  id: string,
  input: { amount?: number | string | null; method?: string | null; note?: string | null },
): Promise<{ error?: string; movimientoId?: string }> {
  const auth = await requireBusinessSession();
  if (!auth.ok) return { error: auth.error };
  if (!auth.staffId) return { error: 'No se pudo identificar quién confirma el fijo' };

  const db = tenantDb(getServiceClient(), auth.businessId);

  const { data: fijo, error: errFijo } = await db
    .table('caja_fijos')
    .select('id, concept, label, amount_sugerido, method_sugerido, active')
    .eq('id', id)
    .maybeSingle();

  if (errFijo) throw new Error(`confirmarFijo lectura: ${errFijo.message}`);
  if (!fijo) return { error: 'Ese gasto fijo ya no existe' };
  const f = fijo as unknown as { concept: string; amount_sugerido: number | string; method_sugerido: string; active: boolean };
  if (!f.active) return { error: 'Ese gasto fijo está desactivado' };

  // Sin monto tecleado se usa el sugerido, pero SOLO porque una persona tocó
  // "Confirmar" mirándolo: el tap es el que afirma el hecho, no el default.
  const mov = resolveMovimiento({
    type:    'salida',
    concept: f.concept,
    amount:  input.amount == null || input.amount === '' ? f.amount_sugerido : input.amount,
    method:  input.method ?? f.method_sugerido,
    note:    input.note ?? null,
  });
  if (esMovimientoError(mov)) return { error: mov.error };

  const timezone = await getBusinessTimezone(auth.businessId);
  const { data, error } = await db
    .table('caja_movimientos')
    .insert({
      type:        mov.type,
      amount:      mov.amount,
      method:      mov.method,
      concept:     mov.concept,
      note:        mov.note,
      staff_id:    auth.staffId,
      fijo_id:     id,
      occurred_on: todayStrInTz(timezone),
    })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`confirmarFijo failed: ${error.message}`);

  // El ajuste va donde uno se dio cuenta. Si falla, el movimiento —que es el
  // hecho— ya quedó: la plantilla es una sugerencia y puede esperar.
  if (mov.amount !== Number(f.amount_sugerido) || mov.method !== f.method_sugerido) {
    await db.table('caja_fijos')
      .update({ amount_sugerido: mov.amount, method_sugerido: mov.method, updated_at: new Date().toISOString() })
      .eq('id', id);
  }

  revalidatePath('/staff');
  revalidatePath('/dashboard');
  return { movimientoId: (data as { id: string } | null)?.id };
}
