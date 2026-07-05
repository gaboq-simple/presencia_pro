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
//   · Polling + walk-in (createAssistantAppointment)                   → PR-4
//   · ActionQueue (walk-in, atrasados, sugerencias 1-tap)             → PR-5
//   · Granularidad fina + pulido                                       → PR-6
//
// Sistema visual: tokens Zentriq claro de globals.css (bg-canvas, teal, ink,
// border-line, tabular-nums…). Cero paleta numérica de Tailwind.

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { DashboardAppointment, DayException } from '@/lib/dashboard.types';
import type { StaffBlockForDay } from '@/app/staff/assistant-actions';
import { rescheduleAppointment } from '@/app/staff/assistant-actions';
import PanoramaTimeline from './PanoramaTimeline';

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
  date,
  timezone,
  initialAppointments,
  staffWithAvailability,
  initialStaffBlocks,
  dayExceptions,
}: AssistantControlDeskProps) {
  const router = useRouter();

  // Reloj "Ahora" — se calcula en cliente para no romper la hidratación.
  const [nowLabel, setNowLabel] = useState<string>('—');
  useEffect(() => {
    function tick() {
      setNowLabel(
        new Date().toLocaleTimeString('es-MX', {
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

  // Citas en estado local: sembradas de props (server) para poder mover en optimista
  // y (a futuro, PR-4) refrescar por polling. Se re-siembra cuando cambian las props
  // (navegación de fecha o router.refresh()).
  const [appointments, setAppointments] = useState<DashboardAppointment[]>(initialAppointments);
  useEffect(() => {
    setAppointments(initialAppointments);
  }, [initialAppointments]);

  // Toast breve para confirmar/errar el reagendado.
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' | 'warn' } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

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

  // Drop del gesto → reagendar. Optimista (la cita "vuela" ya) + revert si la
  // action falla (conflicto de solape, etc.). rescheduleAppointment tiene el gate
  // 2b (barbero solo sus citas; recepción sin restricción).
  async function handleMove(
    apptId: string,
    newStaffId: string,
    newStartMin: number,
    opts?: { force: boolean; overlapMin: number; overlapName: string },
  ) {
    const snapshot = appointments;
    const appt = snapshot.find((a) => a.id === apptId);
    if (!appt) return;
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
          ? { ...a, staff: { id: newStaffId, name: newStaffName }, starts_at: startIso, ends_at: endIso, status: 'confirmed' }
          : a,
      ),
    );

    try {
      await rescheduleAppointment({
        appointmentId: apptId,
        newDate: date,
        newStartTime: `${String(Math.floor(newStartMin / 60)).padStart(2, '0')}:${String(newStartMin % 60).padStart(2, '0')}`,
        newStaffId,
        force: opts?.force, // solape intencional forzado por la recepción
      });
      // Aviso sutil de solape forzado (no frena el flujo).
      const msg = opts?.force
        ? `Movida a ${newStaffName} · ${fmtHora(newStartMin)} · se solapa ${opts.overlapMin} min con ${opts.overlapName}`
        : `Movida a ${newStaffName} · ${fmtHora(newStartMin)}`;
      setToast({ msg, kind: opts?.force ? 'warn' : 'ok' });
      router.refresh(); // reconciliar con la verdad del servidor
    } catch (err) {
      setAppointments(snapshot); // revert
      const msg = err instanceof Error ? err.message : 'No se pudo reagendar';
      setToast({ msg, kind: 'err' });
    }
  }

  return (
    <div className="min-h-dvh bg-canvas bg-grid text-ink">
      <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col gap-3 p-3 sm:p-4">
        {/* ── Tarjeta de la mesa de control ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-card shadow-card">
          {/* ── Header ── */}
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
            {today && (
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span
                  className="inline-block h-2 w-2 rounded-pill bg-red-ink animate-data-beat motion-reduce:animate-none"
                  aria-hidden
                />
                Ahora · <span className="tabular-nums">{nowLabel}</span>
              </div>
            )}

            {/* Navegación de día */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate(addDays(date, -1))}
                className="grid h-8 w-8 place-items-center rounded-pill border border-line text-ink-2 transition hover:bg-canvas"
                aria-label="Día anterior"
              >
                ‹
              </button>
              <span className="min-w-[7.5rem] text-center text-sm font-semibold capitalize">
                {today ? 'Hoy' : formatDateHeader(date)}
              </span>
              <button
                onClick={() => navigate(addDays(date, 1))}
                className="grid h-8 w-8 place-items-center rounded-pill border border-line text-ink-2 transition hover:bg-canvas"
                aria-label="Día siguiente"
              >
                ›
              </button>
              {!today && (
                <button
                  onClick={() => navigate(todayInTz(timezone))}
                  className="ml-1 rounded-pill border border-line px-3 py-1 text-xs font-semibold text-teal-ink transition hover:bg-tint-1"
                >
                  Hoy
                </button>
              )}
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
              {/* Acciones del header — se cablean en sus PRs (buscar → PR-5, nueva cita → PR-4). */}
              <button
                disabled
                title="Disponible en la próxima iteración"
                className="cursor-not-allowed rounded-pill border border-line px-3 py-1.5 text-sm font-medium text-faint"
              >
                Buscar cliente
              </button>
              <button
                disabled
                title="Disponible en la próxima iteración"
                className="cursor-not-allowed rounded-pill border border-line bg-canvas px-3 py-1.5 text-sm font-medium text-faint"
              >
                + Nueva cita
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
                onMove={handleMove}
              />
            </section>

            {/* COLA DE ACCIÓN — fija; se puebla en PR-5 */}
            <aside
              className="flex min-h-0 shrink-0 flex-col bg-canvas lg:w-[348px]"
              aria-label="Cola de acción"
            >
              <div className="border-b border-line px-4 py-3">
                <b className="text-sm">Cola de acción</b>
                <p className="text-xs text-faint">Lo que necesita tu atención ahora</p>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-pill bg-tint-1 text-teal-ink">
                  ✓
                </span>
                <b className="text-sm">Todo bajo control</b>
                <p className="max-w-[24ch] text-xs text-ink-2">
                  Cuando llegue un walk-in o alguien se retrase, aparece aquí.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* Toast de reagendado (confirmación / error) */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-pill border px-4 py-2 text-sm font-semibold shadow-card ${
            toast.kind === 'ok'
              ? 'border-teal-border bg-tint-1 text-teal-ink'
              : toast.kind === 'warn'
                ? 'border-amber-border bg-amber-tint text-amber'
                : 'border-red-border bg-red-tint text-red-ink'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
