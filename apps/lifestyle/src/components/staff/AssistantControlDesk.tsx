// ─── AssistantControlDesk ─────────────────────────────────────────────────────
// Client Component — mesa de control de la Recepción/Asistente (S6-UI-02).
//
// Diverge de AssistantLayout: implementa el diseño congelado
// (design-studies/asistente-FINAL.html) como una vista propia. Se monta SOLO en
// la rama role==='assistant' de dashboard/page.tsx; /staff/gestion (barbero)
// sigue usando AssistantLayout intacto.
//
// Estructura de dos zonas (panorama con scroll propio + cola de acción fija) +
// header con datos reales. Estado de las piezas:
//   · PanoramaTimeline — carriles, ventana 3h navegable, densidad     ✓ PR-2
//   · Gesto click-to-place → rescheduleAppointment (este handleMove)   ✓ PR-3
//   · Polling + walk-in (createAssistantAppointment)                   ✓ PR-4
//   · ActionQueue (atrasados + sugerencia + conexión viva + tranquilo) ✓ PR-5
//   · Granularidad fina + pulido                                       → PR-6
//
// Sistema visual: tokens Zentriq claro de globals.css (bg-canvas, teal, ink,
// border-line, tabular-nums…). Cero paleta numérica de Tailwind.

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { DashboardAppointment, DayException } from '@/lib/dashboard.types';
import type { StaffBlockForDay } from '@/app/staff/assistant-actions';
import {
  rescheduleAppointment,
  refreshAssistantAppointments,
  createAssistantAppointment,
  noShowAppointment,
  getActiveConversations,
} from '@/app/staff/assistant-actions';
import ConversationList from './ConversationList';
import PanoramaTimeline, {
  type MoveState,
  type WalkinRequest,
  type PlaceOpts,
  type RescheduleRequest,
} from './PanoramaTimeline';
import ActionQueue, { type LateItem, type NextUpItem } from './ActionQueue';
import {
  type EngineLane,
  type Interval,
  type OverlapAppt,
  partsInTz,
  minutesOfDay,
  hhmmToMin,
  firstCompatibleSlot,
} from './panoramaEngine';

const POLL_MS = 20_000; // 20s — auto-refresh de la mesa de control (se pausa en gesto)

// ─── Tipos locales ────────────────────────────────────────────────────────────

type StaffOption = {
  id: string;
  name: string;
};

type AvailabilityToday = {
  start_time: string;
  end_time: string;
  break_start?: string | null;
  break_end?: string | null;
};

type StaffWithAvailability = {
  id: string;
  name: string;
  availabilityToday: AvailabilityToday | null;
};

// ─── Props ────────────────────────────────────────────────────────────────────
// Mismo shape que la rama asistente de dashboard/page.tsx ya produce — se
// consume tal cual, sin nuevas queries.

export type AssistantControlDeskProps = {
  businessId: string;
  businessName: string;
  date: string;                                  // 'YYYY-MM-DD'
  timezone: string;                              // IANA timezone del negocio
  initialAppointments: DashboardAppointment[];
  staffOptions: StaffOption[];                   // barberos activos (para nueva cita)
  staffWithAvailability: StaffWithAvailability[];// barberos con horario (para panorama)
  initialStaffBlocks: StaffBlockForDay[];        // bloques aprobados del día
  dayExceptions: DayException[];                 // día libre / horario especial por fecha
  requireCustomerPhone: boolean;                 // businesses.require_customer_phone (walk-in)
  maxLateMinutes: number;                        // businesses.max_late_minutes (piso de "atrasado")
};

// Servicio del catálogo (para el picker del walk-in).
type CatalogService = { id: string; name: string; duration_minutes: number };

// Estado previo EXACTO de una cita antes de un reacomodo — lo que necesita el
// deshacer para restaurar ESA cita (no un reverse ciego). `date`/`hhmm` son la
// hora-de-pared previa en la tz del negocio (para el reschedule inverso).
type ReschedulePrev = {
  apptId: string;
  date: string;         // 'YYYY-MM-DD' previo (tz negocio)
  hhmm: string;         // 'HH:MM' previo 24h (tz negocio)
  startsAtIso: string;  // para el restore optimista
  endsAtIso: string;
  staffId: string;
  staffName: string;
  status: DashboardAppointment['status'];
  allowOverlap: boolean;
};

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Hoy en la tz del NEGOCIO (no UTC): entre 18:00 y 24:00 en México, la fecha UTC
// ya es "mañana" y rompería el "Hoy" del header. 'en-CA' → 'YYYY-MM-DD'.
function isTodayInTz(dateStr: string, timeZone: string): boolean {
  return dateStr === new Date().toLocaleDateString('en-CA', { timeZone });
}

function todayInTz(timeZone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone });
}

// Instante UTC ISO de una hora-de-pared (min desde medianoche) en la tz del negocio.
// Espejo de zonedWallTimeToUtc de dashboard.types.ts — para el update optimista del drop.
function wallMinToIso(dateStr: string, min: number, timeZone: string): string {
  const timeStr = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
  const asIfUtc = new Date(`${dateStr}T${timeStr}Z`).getTime();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(asIfUtc));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const localAsUtc = Date.UTC(
    Number(m['year']), Number(m['month']) - 1, Number(m['day']),
    Number(m['hour'] === '24' ? '0' : m['hour']), Number(m['minute']), Number(m['second']),
  );
  return new Date(asIfUtc - (localAsUtc - asIfUtc)).toISOString();
}

function fmtHora(min: number): string {
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantControlDesk({
  businessId,
  date,
  timezone,
  initialAppointments,
  staffWithAvailability,
  initialStaffBlocks,
  dayExceptions,
  requireCustomerPhone,
  maxLateMinutes,
}: AssistantControlDeskProps) {
  const router = useRouter();

  // Reloj "Ahora" — se calcula en cliente para no romper la hidratación. `nowMs` es
  // el instante (para detectar atraso por instante, tz-independiente); `nowLabel` el
  // texto del header. Ambos refrescan cada 30s.
  const [nowLabel, setNowLabel] = useState<string>('—');
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    function tick() {
      const d = new Date();
      setNowMs(d.getTime());
      setNowLabel(
        d.toLocaleTimeString('es-MX', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: timezone,
        }),
      );
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [timezone]);

  function navigate(targetDate: string) {
    router.push(`/dashboard?date=${targetDate}`);
  }

  const today = isTodayInTz(date, timezone);

  // Citas en estado local: sembradas de props (server) para el optimismo del gesto
  // y el polling. Se re-siembra cuando cambian las props (navegación de fecha o
  // router.refresh()).
  const [appointments, setAppointments] = useState<DashboardAppointment[]>(initialAppointments);
  useEffect(() => {
    setAppointments(initialAppointments);
  }, [initialAppointments]);

  // ── Guardas del polling: NUNCA refrescar a mitad de un gesto o una mutación ──
  const interactingRef = useRef(false); // el panorama tiene una cita levantada / walk-in en curso
  const mutatingRef = useRef(false);    // hay un reschedule/create en vuelo
  const dateRef = useRef(date);
  dateRef.current = date;

  // ── Handoff bot→humano: acceso al chat de conversaciones ────────────────────
  // Reusa los componentes existentes (ConversationList → ChatPanel), que se
  // autoabastecen vía server actions. Aquí solo abrimos/cerramos el sheet y
  // contamos las conversaciones en modo 'human' para el badge del botón.
  const [showConversations, setShowConversations] = useState(false);
  const [humanCount, setHumanCount] = useState(0);

  // Polling cada 20s — refresca las citas del día sin recargar (cita nueva del bot,
  // cambio de otro dispositivo). Se SALTA si hay un gesto en curso o una mutación en
  // vuelo → no le regenera el panorama al asistente a mitad de un reacomodo.
  useEffect(() => {
    // Conteo de conversaciones humanas para el badge. Se refresca aunque haya un
    // gesto en curso (el guard de abajo solo protege el panorama, no el badge).
    const pollHumanCount = async () => {
      try {
        const convs = await getActiveConversations();
        setHumanCount(convs.filter((c) => c.sessionMode === 'human').length);
      } catch {
        // silencioso — el próximo tick reintenta
      }
    };
    void pollHumanCount(); // conteo inicial
    const id = setInterval(async () => {
      void pollHumanCount();
      if (interactingRef.current || mutatingRef.current) return;
      try {
        const fresh = await refreshAssistantAppointments(dateRef.current);
        // Re-chequear el guard: el asistente pudo empezar un gesto durante el await.
        if (!interactingRef.current && !mutatingRef.current) setAppointments(fresh);
      } catch {
        // silencioso — el próximo tick reintenta
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Toast breve para confirmar/errar el reagendado. Un reschedule exitoso lleva
  // `undo` (botón Deshacer) y una ventana más larga; el resto usa el default.
  const [toast, setToast] = useState<
    { msg: string; kind: 'ok' | 'err' | 'warn'; undo?: () => void; duration?: number } | null
  >(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.duration ?? 3500);
    return () => clearTimeout(id);
  }, [toast]);

  // ── Cola de acción: conexión viva + reacomodo desde tarjeta ─────────────────
  const [highlightId, setHighlightId] = useState<string | null>(null); // hover en tarjeta → resalta panorama
  const [reschedReq, setReschedReq] = useState<RescheduleRequest | null>(null); // "Mover" → levanta la cita

  // ── Walk-in a mano ─────────────────────────────────────────────────────────
  const [walkin, setWalkin] = useState<WalkinRequest | null>(null); // gesto de colocar activo
  const [sheetOpen, setSheetOpen] = useState(false);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [wiName, setWiName] = useState('');
  const [wiPhone, setWiPhone] = useState('');
  const [wiServiceId, setWiServiceId] = useState('');

  // Catálogo de servicios (lazy, al abrir la hoja) — para el picker de servicio.
  useEffect(() => {
    if (!sheetOpen || services.length > 0) return;
    fetch(`/api/catalog?businessId=${businessId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((body: { services?: CatalogService[] }) => {
        const svc = body.services ?? [];
        setServices(svc);
        if (svc[0] && !wiServiceId) setWiServiceId(svc[0].id);
      })
      .catch(() => {});
  }, [sheetOpen, businessId, services.length, wiServiceId]);

  function startWalkin() {
    const name = wiName.trim();
    if (!name) return; // nombre requerido
    if (requireCustomerPhone && !wiPhone.trim()) return; // teléfono requerido por el negocio
    // Servicio opcional → default al primero del catálogo (su duración). Su serviceId
    // es real (createAssistantAppointment lo exige); la duración ilumina los huecos.
    const svc = services.find((s) => s.id === wiServiceId) ?? services[0];
    setWalkin({
      serviceId: svc?.id ?? '',
      dur: svc?.duration_minutes ?? 30,
      name,
      service: svc?.name ?? 'Walk-in',
      phone: wiPhone.trim() || undefined,
    });
    setSheetOpen(false);
    setWiName('');
    setWiPhone('');
  }

  // Barberos del panorama: los que TIENEN TURNO HOY (availabilityToday != null →
  // fila en staff_availability para el día), ordenados por actividad (más citas
  // arriba — el asistente los vigila más). Un barbero con turno pero SIN citas SÍ
  // aparece: su carril vacío = disponibilidad para encajar walk-ins, no ruido.
  const apptCountByStaff = new Map<string, number>();
  for (const a of appointments) {
    if (a.status === 'cancelled') continue;
    apptCountByStaff.set(a.staff.id, (apptCountByStaff.get(a.staff.id) ?? 0) + 1);
  }
  // Excepciones de fecha: día libre saca al barbero del panorama; horario especial
  // reemplaza su ventana del día. Se aplican ANTES del filtro "trabaja hoy".
  const exceptionByStaff = new Map<string, DayException>();
  for (const e of dayExceptions) exceptionByStaff.set(e.staff_id, e);

  const workingStaff = staffWithAvailability
    .map((s) => {
      const ex = exceptionByStaff.get(s.id);
      if (!ex) return s;
      if (!ex.available) return { ...s, availabilityToday: null }; // día libre
      if (ex.start_time && ex.end_time && s.availabilityToday) {
        // Horario especial: reemplaza la ventana (y elimina el break del día base).
        return {
          ...s,
          availabilityToday: { start_time: ex.start_time, end_time: ex.end_time, break_start: null, break_end: null },
        };
      }
      return s;
    })
    .filter((s) => s.availabilityToday !== null)
    .sort(
      (a, b) =>
        (apptCountByStaff.get(b.id) ?? 0) - (apptCountByStaff.get(a.id) ?? 0) ||
        a.name.localeCompare(b.name),
    );

  // Drop del gesto → despacha por tipo de sujeto: reacomodo de cita existente o
  // colocación de un walk-in nuevo. Ambos: optimista + revert si el server rechaza.
  function handlePlace(move: MoveState, newStaffId: string, newStartMin: number, opts?: PlaceOpts) {
    if (move.kind === 'reschedule') {
      void handleReschedule(move.apptId, newStaffId, newStartMin, opts);
    } else {
      void handleWalkinPlace(move, newStaffId, newStartMin, opts);
    }
  }

  // Reacomodo → rescheduleAppointment (gate 2b; recepción sin restricción).
  async function handleReschedule(
    apptId: string,
    newStaffId: string,
    newStartMin: number,
    opts?: PlaceOpts,
  ) {
    const snapshot = appointments;
    const appt = snapshot.find((a) => a.id === apptId);
    if (!appt) return;

    // Estado previo EXACTO de ESTA cita (autónomo, para un deshacer robusto al
    // tiempo real): no es un "reverse" ciego, es restaurar estos campos a este id.
    const prevParts = partsInTz(appt.starts_at, timezone);
    const prev: ReschedulePrev = {
      apptId,
      date: prevParts.ymd,
      hhmm: `${String(Math.floor(prevParts.min / 60)).padStart(2, '0')}:${String(prevParts.min % 60).padStart(2, '0')}`,
      startsAtIso: appt.starts_at,
      endsAtIso: appt.ends_at,
      staffId: appt.staff.id,
      staffName: appt.staff.name,
      status: appt.status,
      allowOverlap: appt.allow_overlap === true,
    };

    const dur = Math.max(
      1,
      Math.round((Date.parse(appt.ends_at) - Date.parse(appt.starts_at)) / 60_000),
    );
    const startIso = wallMinToIso(date, newStartMin, timezone);
    const endIso = new Date(Date.parse(startIso) + dur * 60_000).toISOString();
    const newStaffName = workingStaff.find((s) => s.id === newStaffId)?.name ?? appt.staff.name;

    setAppointments((cur) =>
      cur.map((a) =>
        a.id === apptId
          ? {
              ...a,
              staff: { id: newStaffId, name: newStaffName },
              starts_at: startIso,
              ends_at: endIso,
              status: 'confirmed',
              allow_overlap: opts?.force === true, // solape aprobado → indicador visible ya
            }
          : a,
      ),
    );

    mutatingRef.current = true;
    try {
      const res = await rescheduleAppointment({
        appointmentId: apptId,
        newDate: date,
        newStartTime: `${String(Math.floor(newStartMin / 60)).padStart(2, '0')}:${String(newStartMin % 60).padStart(2, '0')}`,
        newStaffId,
        force: opts?.force, // solape intencional forzado por la recepción
      });
      // Rechazo esperado (gate 2b "solo tus citas", solape, cita no encontrada) →
      // llega como { error }, NO throw. Revertir el optimista y avisar inline.
      if (res?.error) {
        setAppointments(snapshot); // revert
        setToast({ msg: res.error, kind: 'err' });
        return;
      }
      // Toast con Deshacer (6s). El solape forzado además avisa en ámbar.
      const label = appt.customer?.name ?? 'Cita';
      const msg = opts?.force
        ? `${label} movida · ${newStaffName} ${fmtHora(newStartMin)} · ⚠ se solapa ${opts.overlapMin}m con ${opts.overlapName}`
        : `${label} movida · ${newStaffName} ${fmtHora(newStartMin)}`;
      setToast({
        msg,
        kind: opts?.force ? 'warn' : 'ok',
        duration: 6000,
        undo: () => void undoReschedule(prev),
      });
      router.refresh(); // reconciliar con la verdad del servidor
    } catch {
      setAppointments(snapshot); // revert — fallo de sistema, no tumba la mesa
      setToast({ msg: 'No se pudo reagendar', kind: 'err' });
    } finally {
      mutatingRef.current = false;
    }
  }

  // Deshacer un reacomodo: un SEGUNDO reschedule que restaura el estado previo
  // EXACTO de esa cita (hora/barbero/solape anteriores). Robusto al tiempo real:
  // toca solo ese id, no asume que el resto sigue igual. Si el hueco previo ya se
  // ocupó (otro flujo lo tomó mientras el toast estaba arriba) → avisa con gracia,
  // NO fuerza un solape en silencio. El audit captura este reschedule también (045).
  async function undoReschedule(prev: ReschedulePrev) {
    // Optimista: restaurar localmente los campos previos de esa cita. Capturo el
    // snapshot vigente dentro del updater (el estado actual, no el del render viejo).
    let snapshot: DashboardAppointment[] = [];
    setAppointments((cur) => {
      snapshot = cur;
      return cur.map((a) =>
        a.id === prev.apptId
          ? {
              ...a,
              staff: { id: prev.staffId, name: prev.staffName },
              starts_at: prev.startsAtIso,
              ends_at: prev.endsAtIso,
              status: prev.status,
              allow_overlap: prev.allowOverlap,
            }
          : a,
      );
    });

    mutatingRef.current = true;
    try {
      const res = await rescheduleAppointment({
        appointmentId: prev.apptId,
        newDate: prev.date,
        newStartTime: prev.hhmm,
        newStaffId: prev.staffId,
        force: prev.allowOverlap, // reproduce el estado de solape que tenía; si era limpio, NO fuerza
      });
      if (res?.error) {
        // El hueco previo ya no está libre (u otro rechazo) → revertir el optimista
        // del undo (la cita se queda donde el reacomodo la dejó) y avisar honesto.
        setAppointments(snapshot);
        setToast({ msg: 'No se pudo deshacer: el horario anterior ya está ocupado', kind: 'err' });
        return;
      }
      setToast({ msg: `${prev.staffName} ${prev.hhmm} · movimiento deshecho`, kind: 'ok' });
      router.refresh();
    } catch {
      setAppointments(snapshot);
      setToast({ msg: 'No se pudo deshacer', kind: 'err' });
    } finally {
      mutatingRef.current = false;
    }
  }

  // Walk-in → createAssistantAppointment (source='walkin'). Optimista con una cita
  // sintética + revert si el server rechaza (teléfono requerido, tope, solape sin
  // forzar…). createAssistantAppointment devuelve { error } de cara al usuario.
  async function handleWalkinPlace(
    move: Extract<MoveState, { kind: 'walkin' }>,
    newStaffId: string,
    newStartMin: number,
    opts?: PlaceOpts,
  ) {
    const snapshot = appointments;
    const startIso = wallMinToIso(date, newStartMin, timezone);
    const endIso = new Date(Date.parse(startIso) + move.dur * 60_000).toISOString();
    const newStaffName = workingStaff.find((s) => s.id === newStaffId)?.name ?? '';
    const tempId = `temp-walkin-${startIso}`;

    // Optimista: cita sintética (se reconcilia con router.refresh tras el create).
    const optimistic = {
      id: tempId,
      starts_at: startIso,
      ends_at: endIso,
      status: 'walkin',
      source: 'walkin',
      notes: null,
      staff: { id: newStaffId, name: newStaffName },
      service: { id: move.serviceId, name: move.service, duration_minutes: move.dur, price: 0, currency: 'MXN' },
      customer: { id: tempId, name: move.name, phone: move.phone ?? null },
      created_by: null,
      modified_by: null,
      modified_at: null,
      allow_overlap: opts?.force === true,
    } as unknown as DashboardAppointment;
    setAppointments((cur) => [...cur, optimistic]);

    mutatingRef.current = true;
    try {
      const res = await createAssistantAppointment({
        staffId: newStaffId,
        serviceId: move.serviceId,
        startsAt: startIso,
        endsAt: endIso,
        source: 'walkin',
        customerName: move.name,
        customerPhone: move.phone,
        force: opts?.force,
      });
      if (res.error) {
        setAppointments(snapshot); // revert
        setToast({ msg: res.error, kind: 'err' });
        return;
      }
      const overlapNote = opts?.force ? ` · se solapa ${opts.overlapMin} min con ${opts.overlapName}` : '';
      const flagNote = res.warning ? ` · ⚠ ${res.warning}` : '';
      setToast({
        msg: `Walk-in de ${move.name} → ${newStaffName} · ${fmtHora(newStartMin)}${overlapNote}${flagNote}`,
        kind: opts?.force || res.warning ? 'warn' : 'ok',
      });
      router.refresh();
    } catch (err) {
      setAppointments(snapshot); // revert
      const msg = err instanceof Error ? err.message : 'No se pudo crear el walk-in';
      setToast({ msg, kind: 'err' });
    } finally {
      mutatingRef.current = false;
    }
  }

  // ── Cola de acción: atrasados + sugerencia + próxima cita ───────────────────
  // "Ahora" en min-desde-medianoche (tz) — piso de la sugerencia y hora de display.
  const nowMin = nowMs !== null ? partsInTz(new Date(nowMs).toISOString(), timezone).min : null;

  // Carriles reducidos para el motor: MISMA aritmética que el gesto (panoramaEngine),
  // no una copia. Breaks + bloqueos aprobados como frontera dura; guard de duración.
  const engineLanes: EngineLane[] = workingStaff.map((s) => {
    const av = s.availabilityToday!; // workingStaff ya filtró availabilityToday !== null
    const unavail: Interval[] = [];
    if (av.break_start && av.break_end) {
      unavail.push({ start: hhmmToMin(av.break_start), end: hhmmToMin(av.break_end) });
    }
    for (const bl of initialStaffBlocks) {
      if (bl.staffId !== s.id) continue;
      const bs = minutesOfDay(bl.startsAt, timezone);
      const be = minutesOfDay(bl.endsAt, timezone);
      if (be > bs) unavail.push({ start: bs, end: be });
    }
    const appts: OverlapAppt[] = appointments
      .filter((a) => a.staff.id === s.id && a.status !== 'cancelled')
      .map((a) => {
        const start = minutesOfDay(a.starts_at, timezone);
        let end = minutesOfDay(a.ends_at, timezone);
        if (end <= start) end = start + 30;
        return { id: a.id, start, dur: end - start, name: a.customer?.name ?? 'Sin nombre' };
      });
    return {
      staffId: s.id,
      availFrom: hhmmToMin(av.start_time),
      availTo: hhmmToMin(av.end_time),
      unavail,
      appts,
    };
  });

  const staffNameById = new Map(workingStaff.map((s) => [s.id, s.name]));

  // Señal "atrasado" anclada en schema: status='confirmed' cuya hora EFECTIVA
  // (adjusted_starts_at ?? starts_at) ya pasó por más de `maxLateMinutes`. Comparación
  // por INSTANTE (tz-independiente). Techo natural: dispatch-auto-cancel la vuelve
  // no_show y sale sola. Solo HOY (la cola es "ahora"); walk-ins quedan fuera (modo B).
  const lateItems: LateItem[] =
    today && nowMs !== null && nowMin !== null
      ? appointments
          .filter((a) => {
            if (a.status !== 'confirmed') return false;
            const effStart = Date.parse(a.adjusted_starts_at ?? a.starts_at);
            return nowMs >= effStart + maxLateMinutes * 60_000;
          })
          .map((a) => {
            const effIso = a.adjusted_starts_at ?? a.starts_at;
            const dur = Math.max(1, Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000));
            const lateMin = Math.max(0, Math.round((nowMs - Date.parse(effIso)) / 60_000));
            const slot = firstCompatibleSlot(engineLanes, dur, nowMin, a.id);
            return {
              apptId: a.id,
              customerName: a.customer?.name ?? 'Sin nombre',
              serviceName: a.service?.name ?? '',
              staffName: a.staff.name,
              startMin: minutesOfDay(effIso, timezone),
              lateMin,
              suggestion: slot ? { staffName: staffNameById.get(slot.staffId) ?? '', min: slot.min } : null,
            };
          })
          .sort((a, b) => b.lateMin - a.lateMin) // más atrasado primero
      : [];

  // Próxima cita (estado tranquilo): siguiente confirmada de hoy tras "ahora".
  const nextUp: NextUpItem | null =
    today && nowMin !== null
      ? (() => {
          const upcoming = appointments
            .filter((a) => a.status === 'confirmed' && minutesOfDay(a.starts_at, timezone) > nowMin)
            .sort((a, b) => minutesOfDay(a.starts_at, timezone) - minutesOfDay(b.starts_at, timezone))[0];
          return upcoming
            ? {
                customerName: upcoming.customer?.name ?? 'Sin nombre',
                serviceName: upcoming.service?.name ?? '',
                staffName: upcoming.staff.name,
                startMin: minutesOfDay(upcoming.starts_at, timezone),
              }
            : null;
        })()
      : null;

  // "Mover" en la tarjeta → levanta la cita en el panorama (MISMO gesto #64, no
  // reimplementa el reacomodo). El drop de la cita cae en handleReschedule.
  function handleMoveFromQueue(apptId: string) {
    const appt = appointments.find((a) => a.id === apptId);
    if (!appt) return;
    const dur = Math.max(1, Math.round((Date.parse(appt.ends_at) - Date.parse(appt.starts_at)) / 60_000));
    setHighlightId(null);
    setReschedReq({
      apptId,
      dur,
      name: appt.customer?.name ?? 'Sin nombre',
      service: appt.service?.name ?? '',
      fromLaneId: appt.staff.id,
    });
  }

  // "Marcar no llegó" → no_show (libera el hueco). Optimista + revert.
  async function handleNoShow(apptId: string) {
    const snapshot = appointments;
    const appt = snapshot.find((a) => a.id === apptId);
    if (!appt) return;
    setHighlightId(null);
    setAppointments((cur) => cur.map((a) => (a.id === apptId ? { ...a, status: 'no_show' } : a)));
    mutatingRef.current = true;
    try {
      const res = await noShowAppointment(apptId);
      // Rechazo esperado (gate 2b, cita no encontrada) → { error }, no throw.
      if (res?.error) {
        setAppointments(snapshot); // revert
        setToast({ msg: res.error, kind: 'err' });
        return;
      }
      setToast({ msg: `${appt.customer?.name ?? 'Cliente'} marcado como no llegó`, kind: 'ok' });
      router.refresh();
    } catch {
      setAppointments(snapshot); // revert — fallo de sistema, no tumba la mesa
      setToast({ msg: 'No se pudo marcar', kind: 'err' });
    } finally {
      mutatingRef.current = false;
    }
  }

  return (
    <div className="min-h-dvh bg-canvas bg-grid text-ink">
      <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col gap-3 p-3 sm:p-4">
        {/* ── Tarjeta de la mesa de control ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-card shadow-card">
          {/* ── Header ── */}
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
            {/* Ancho fijo reservado: el indicador "Ahora" solo tiene contenido en Hoy,
                pero su espacio se mantiene en otros días para que la navegación de día
                NO se reposicione (los chevrones ‹ › quedan anclados). */}
            <div className="flex w-40 items-center gap-2 text-sm font-semibold">
              {today && (
                <>
                  <span
                    className="inline-block h-2 w-2 rounded-pill bg-red-ink animate-data-beat motion-reduce:animate-none"
                    aria-hidden
                  />
                  Ahora · <span className="tabular-nums">{nowLabel}</span>
                </>
              )}
            </div>

            {/* Navegación de día */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate(addDays(date, -1))}
                className="grid h-8 w-8 place-items-center rounded-pill border border-line text-ink-2 transition hover:bg-canvas active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-ink"
                aria-label="Día anterior"
              >
                ‹
              </button>
              <span className="min-w-[7.5rem] text-center text-sm font-semibold capitalize">
                {today ? 'Hoy' : formatDateHeader(date)}
              </span>
              <button
                onClick={() => navigate(addDays(date, 1))}
                className="grid h-8 w-8 place-items-center rounded-pill border border-line text-ink-2 transition hover:bg-canvas active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-ink"
                aria-label="Día siguiente"
              >
                ›
              </button>
              {/* Siempre presente para reservar su espacio; invisible en Hoy (no
                  reflowea la nav de día al cambiar de fecha). */}
              <button
                onClick={() => navigate(todayInTz(timezone))}
                disabled={today}
                aria-hidden={today}
                tabIndex={today ? -1 : undefined}
                className={`ml-1 rounded-pill border border-line px-3 py-1 text-xs font-semibold text-teal-ink transition hover:bg-tint-1 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-ink ${
                  today ? 'invisible pointer-events-none' : ''
                }`}
              >
                Hoy
              </button>
            </div>

            <div className="h-5 w-px bg-line" aria-hidden />

            {/* Stats */}
            <div className="flex items-center gap-4">
              <div className="flex flex-col leading-tight">
                <b className="tabular-nums text-base">
                  {appointments.filter((a) => a.status !== 'cancelled').length}
                </b>
                <span className="text-xs text-faint">Citas hoy</span>
              </div>
              <div className="flex flex-col leading-tight">
                <b className="tabular-nums text-base">{workingStaff.length}</b>
                <span className="text-xs text-faint">Barberos hoy</span>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* Conversaciones (handoff bot→humano) — abre ConversationList */}
              <button
                onClick={() => setShowConversations(true)}
                aria-label="Conversaciones de WhatsApp"
                className="relative flex items-center gap-1.5 rounded-pill border border-line px-3 py-1.5 text-sm font-medium text-ink-2 transition hover:bg-canvas active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-ink"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                  />
                </svg>
                Conversaciones
                {humanCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-teal px-1 text-[10px] font-bold text-card">
                    {humanCount > 9 ? '9+' : humanCount}
                  </span>
                )}
              </button>
              {/* Buscar cliente → pieza aparte (searchCustomers), fuera del núcleo PR-5. */}
              <button
                disabled
                title="Disponible en la próxima iteración"
                className="cursor-not-allowed rounded-pill border border-line px-3 py-1.5 text-sm font-medium text-faint"
              >
                Buscar cliente
              </button>
              <button
                onClick={() => setSheetOpen(true)}
                disabled={walkin !== null}
                className="rounded-pill border border-teal-border bg-tint-1 px-3 py-1.5 text-sm font-semibold text-teal-ink transition hover:bg-tint-2 enabled:active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-ink"
              >
                + Walk-in
              </button>
            </div>
          </header>

          {/* ── Deck: dos zonas (panorama scroll propio + cola fija) ── */}
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* PANORAMA — placeholder estructural; la pieza rica llega en PR-2 */}
            <section
              className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:border-r lg:border-line"
              aria-label="Panorama de barberos"
            >
              <PanoramaTimeline
                date={date}
                timezone={timezone}
                appointments={appointments}
                staff={workingStaff}
                staffBlocks={initialStaffBlocks}
                onPlace={handlePlace}
                walkinRequest={walkin}
                onWalkinConsumed={() => setWalkin(null)}
                rescheduleRequest={reschedReq}
                onRescheduleConsumed={() => setReschedReq(null)}
                highlightApptId={highlightId}
                onInteractingChange={(active) => { interactingRef.current = active; }}
              />
            </section>

            {/* COLA DE ACCIÓN — fija; atrasados + tranquilo (PR-5) */}
            <ActionQueue
              lateItems={lateItems}
              nextUp={nextUp}
              onMove={handleMoveFromQueue}
              onNoShow={handleNoShow}
              onHover={setHighlightId}
            />
          </div>
        </div>
      </div>

      {/* Hoja de captura del walk-in (mínima: nombre + tel + servicio) */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30 sm:items-center"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-card border border-line bg-card p-5 shadow-hero sm:rounded-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">Nuevo walk-in</h2>
            <p className="mt-0.5 text-xs text-faint">
              Captura lo mínimo; después tocás el hueco donde encaja.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Nombre</span>
                <input
                  value={wiName}
                  onChange={(e) => setWiName(e.target.value)}
                  autoFocus
                  placeholder="Cliente"
                  className="rounded-pill border border-line px-3 py-2 text-sm outline-none focus:border-teal-border"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                  Teléfono {requireCustomerPhone ? <span className="text-red-ink">(requerido)</span> : <span className="text-faint">(opcional)</span>}
                </span>
                <input
                  value={wiPhone}
                  onChange={(e) => setWiPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="55…"
                  className="rounded-pill border border-line px-3 py-2 text-sm tabular-nums outline-none focus:border-teal-border"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Servicio <span className="text-faint">(opcional)</span></span>
                <select
                  value={wiServiceId}
                  onChange={(e) => setWiServiceId(e.target.value)}
                  className="rounded-pill border border-line px-3 py-2 text-sm outline-none focus:border-teal-border"
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.duration_minutes} min
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setSheetOpen(false)}
                className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink-2 transition hover:bg-canvas"
              >
                Cancelar
              </button>
              <button
                onClick={startWalkin}
                disabled={!wiName.trim() || (requireCustomerPhone && !wiPhone.trim())}
                className="rounded-pill bg-teal px-4 py-2 text-sm font-bold text-card shadow-card transition hover:opacity-90 disabled:opacity-40"
              >
                Elegir hueco →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat de conversaciones (handoff). ConversationList/ChatPanel usan z-20/z-30
          internos; el wrapper crea un stacking context a z-[60] para quedar por
          encima de la hoja de walk-in (z-40) y el toast (z-50) del desk. */}
      {showConversations && (
        <div className="relative z-[60]">
          <ConversationList onClose={() => setShowConversations(false)} />
        </div>
      )}

      {/* Toast de reagendado (confirmación / error) + Deshacer en reschedule */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-pill border px-4 py-2 text-sm font-semibold shadow-card ${
            toast.kind === 'ok'
              ? 'border-teal-border bg-tint-1 text-teal-ink'
              : toast.kind === 'warn'
                ? 'border-amber-border bg-amber-tint text-amber'
                : 'border-red-border bg-red-tint text-red-ink'
          }`}
        >
          <span>{toast.msg}</span>
          {toast.undo && (
            <button
              onClick={() => {
                const fn = toast.undo;
                setToast(null); // cierra el toast al tocar Deshacer
                fn?.();
              }}
              className="-my-0.5 rounded-pill border border-current px-2.5 py-0.5 text-xs font-bold transition hover:bg-card/40"
            >
              Deshacer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
