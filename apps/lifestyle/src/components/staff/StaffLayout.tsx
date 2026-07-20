// ─── StaffLayout ─────────────────────────────────────────────────────────────
// Client Component — shell UNIFICADO de la vista del barbero.
//
// Reemplaza las dos vistas separadas (/staff día/semana + /staff/gestion): un solo
// lugar con tab bar mobile-first → Hoy / Semana / Cierre. El barbero ve y gestiona
// SOLO sus citas (modelo rico DashboardAppointment acotado por staff_id en el
// servidor). El panorama del negocio es de recepción, no vive aquí.
//
// Pestañas:
//   · Hoy    → HeroCard (cliente enfrente, fijo, Paso 3), DayBar, "+ Nueva cita",
//              AppointmentThread (hilo + swipe Terminó/No vino + ficha, Paso 4).
//   · Semana → BarberWeekView + BlockRequestForm + RecurringAvailability.
//   · Cierre → EndOfDaySummary (matriz de fin de jornada).
//
// Datos: polling cada 30s (ls_session por PIN, sin Supabase Auth → sin Realtime) +
// refresh optimista post-mutación vía refreshStaffDayAppointments (scopeado al barbero).

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type {
  DashboardAppointment,
  StaffAvailabilitySlot,
  StaffBlockRequest,
} from '@/lib/dashboard.types';
import type { BarberDayAppointment } from '@/lib/barberDay';
import { computeDayDrift, DRIFT_THRESHOLD_MIN, type DriftProjection } from '@/lib/dayDrift';
import { isTodayInTz, todayStrInTz } from '@/lib/dayWindow';
import { refreshStaffDayAppointments } from '@/app/staff/actions';
import HeroCard from './HeroCard';
import DayBar from './DayBar';
import DayDriftNotice from './DayDriftNotice';
import AppointmentThread from './AppointmentThread';
import EndOfDaySummary from './EndOfDaySummary';
import TipSheet from './TipSheet';
import TipsSummary from './TipsSummary';
import BarberWeekView from './BarberWeekView';
import BlockRequestForm from './BlockRequestForm';
import RecurringAvailability from './RecurringAvailability';
import NewAppointmentForm from './NewAppointmentForm';

// ─── Props ────────────────────────────────────────────────────────────────────

type StaffOption = { id: string; name: string };

export type StaffLayoutProps = {
  staffId: string;
  staffName: string;
  businessId: string;
  date: string;                              // 'YYYY-MM-DD'
  timezone: string;                          // IANA — para la línea "Ahora" del timeline
  initialAppointments: BarberDayAppointment[];  // modelo barbero: CON tipAmount (Paso 7)
  availability: StaffAvailabilitySlot[];
  initialBlockRequests: StaffBlockRequest[];
  staffOptions: StaffOption[];               // [el propio barbero] — se agenda solo a sí mismo
};

// ─── Config ───────────────────────────────────────────────────────────────────

const POLL_MS = 30_000; // 30 segundos

const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'walkin']);
const TERMINAL_STATUSES = new Set(['completed', 'no_show', 'cancelled']);

type Tab = 'hoy' | 'semana' | 'cierre';

const TABS: { id: Tab; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'cierre', label: 'Cierre' },
];

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// Mismo predicado que EndOfDaySummary — para saber si mostrar el resumen o el
// placeholder de la pestaña Cierre (no toca el componente, solo decide el marco).
// "Hoy" en la tz del NEGOCIO (isTodayInTz canónico) — con el naive de antes, un
// barbero después de las 18:00 MX nunca veía su cierre (el server UTC ya iba en
// el día siguiente).
function isEndOfDay(appointments: DashboardAppointment[], dateStr: string, tz: string): boolean {
  if (!isTodayInTz(dateStr, tz)) return false;
  if (appointments.length === 0) return false;
  if (appointments.some((a) => ACTIVE_STATUSES.has(a.status))) return false;
  return appointments.every((a) => TERMINAL_STATUSES.has(a.status));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffLayout({
  staffId,
  staffName,
  businessId,
  date,
  timezone,
  initialAppointments,
  availability,
  initialBlockRequests,
  staffOptions,
}: StaffLayoutProps) {
  const router = useRouter();

  const [appointments, setAppointments] =
    useState<BarberDayAppointment[]>(initialAppointments);
  const [syncedDate, setSyncedDate] = useState(date);
  if (syncedDate !== date) {
    setSyncedDate(date);
    setAppointments(initialAppointments);
  }

  const [tab, setTab] = useState<Tab>('hoy');
  const [showNewForm, setShowNewForm] = useState(false);
  // Cita que ocupa el hero → el hilo la muestra como referencia, no duplicada.
  const [heroApptId, setHeroApptId] = useState<string | null>(null);

  // ── La hoja de propina (Paso 7) ───────────────────────────────────────────
  // Sube al confirmarse un Terminó (hero / ficha / swipe post-Deshacer) y al
  // tocar un cabo suelto ("+ propina"). Cierra SOLO por acción explícita.
  const [tipAppt, setTipAppt] = useState<BarberDayAppointment | null>(null);
  const openTip = useCallback((appt: BarberDayAppointment) => { setTipAppt(appt); }, []);
  const appointmentsRef = useRef(appointments);
  useEffect(() => { appointmentsRef.current = appointments; });
  // El hero solo conoce el id — se resuelve contra el estado vigente.
  const openTipById = useCallback((id: string) => {
    const appt = appointmentsRef.current.find((a) => a.id === id);
    if (appt) setTipAppt(appt);
  }, []);

  // Ref para leer la fecha dentro del intervalo sin re-suscribir el polling.
  const dateRef = useRef(date);
  useEffect(() => { dateRef.current = date; });

  // ── El día se corrió (Paso 6) ─────────────────────────────────────────────
  // Tick del ahora (solo cliente, solo si `date` es hoy en la tz del negocio —
  // null en SSR evita hydration mismatch y el drift aparece tras hidratar).
  // Reset a null en el sync de render (patrón DayBar) — no setState en el effect.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [prevDriftKey, setPrevDriftKey] = useState(`${date}|${timezone}`);
  const driftKey = `${date}|${timezone}`;
  if (prevDriftKey !== driftKey) {
    setPrevDriftKey(driftKey);
    if (!isTodayInTz(date, timezone)) setNowMs(null);
  }
  useEffect(() => {
    if (!isTodayInTz(date, timezone)) return;
    const update = () => setNowMs(Date.now());
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [date, timezone]);

  // El corrimiento nace SOLO de completed_at (módulo puro dayDrift). El umbral
  // (10 min) gatea TODAS las superficies: aviso, horas tachadas y fantasma de la
  // barra — por debajo, el día se muestra como siempre.
  const drift = useMemo(
    () => (nowMs === null ? null : computeDayDrift(appointments, nowMs)),
    [appointments, nowMs],
  );
  const driftVisible = drift !== null && drift.driftMin >= DRIFT_THRESHOLD_MIN;
  const driftProjections = useMemo<DriftProjection[]>(
    () => (driftVisible ? drift!.projections.filter((p) => p.shiftMin >= DRIFT_THRESHOLD_MIN) : []),
    [drift, driftVisible],
  );
  const projectionById = useMemo(
    () => new Map(driftProjections.map((p) => [p.apptId, p])),
    [driftProjections],
  );

  // ── Refresh (scopeado al barbero) ───────────────────────────────────────────
  const refresh = useCallback(async () => {
    const fresh = await refreshStaffDayAppointments(dateRef.current);
    setAppointments(fresh);
  }, []);

  // ── Polling cada 30s ──────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // ── Navegación entre días ─────────────────────────────────────────────────
  function navigate(targetDate: string) {
    router.push(`/staff?date=${targetDate}`);
  }

  const prevDate  = addDays(date, -1);
  const nextDate  = addDays(date, +1);
  // "Hoy" del NEGOCIO (no del browser/server) — destino del botón "Ir a hoy".
  const todayDate = todayStrInTz(timezone);

  // Navegación de día — relevante en Hoy (Semana tiene su propia navegación
  // interna; Cierre es siempre "hoy").
  const showDayNav = tab === 'hoy';

  return (
    <div className="min-h-screen bg-canvas bg-grid pb-20">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      {/* z-20: por encima de la marca del ahora del DayBar (z-10 en <main>), que si no
          se pinta sobre el hero fijo al scrollear (mismo z → gana el orden del DOM). */}
      <header className="sticky top-0 z-20 border-b border-line bg-card px-4 py-3">
        <div className="mx-auto max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            {staffName}
          </p>

          {showDayNav && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <button
                onClick={() => navigate(prevDate)}
                aria-label="Día anterior"
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-tint-1 active:bg-tint-2"
              >
                ‹
              </button>

              <div className="text-center">
                <p className="text-sm font-semibold capitalize text-ink">
                  {formatDateHeader(date)}
                </p>
                {!isTodayInTz(date, timezone) && (
                  <button
                    onClick={() => navigate(todayDate)}
                    className="mt-0.5 text-xs text-teal-ink underline hover:text-teal-border"
                  >
                    Ir a hoy
                  </button>
                )}
              </div>

              <button
                onClick={() => navigate(nextDate)}
                aria-label="Día siguiente"
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-tint-1 active:bg-tint-2"
              >
                ›
              </button>
            </div>
          )}

          {/* Hero — el cliente que tenés enfrente (Paso 3). Fijo (dentro del header
              sticky) y condensa a barra fina al scrollear. Solo en Hoy. */}
          {tab === 'hoy' && (
            <div className="mt-3">
              <HeroCard
                appointments={appointments}
                timezone={timezone}
                onMutated={() => void refresh()}
                onRegister={() => setShowNewForm(true)}
                onHeroAppointmentChange={setHeroApptId}
                onCompleted={openTipById}
              />
            </div>
          )}
        </div>
      </header>

      {/* ── Cuerpo ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        {tab === 'hoy' && (
          <>
            {/* Barra del día — el ancho es el tiempo (Paso 2). Con el día corrido,
                los bloques futuros se desplazan a su hora real y dejan el fantasma
                punteado donde estaban (Paso 6). */}
            <DayBar
              appointments={appointments}
              availability={availability}
              date={date}
              timezone={timezone}
              projections={projectionById}
            />

            {/* + Nueva cita */}
            <button
              onClick={() => setShowNewForm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-ink py-3 text-sm font-semibold text-card hover:opacity-90 active:opacity-80"
            >
              <span className="text-lg leading-none">+</span>
              Nueva cita
            </button>

            {/* El día se corrió (Paso 6) — aviso NEUTRO arriba del hilo: sujeto =
                el día, gris, sin alarma. Solo con corrimiento ≥ umbral. */}
            {driftVisible && nowMs !== null && (
              <DayDriftNotice
                projections={driftProjections}
                appointments={appointments}
                timezone={timezone}
                nowMs={nowMs}
                driftMin={drift!.driftMin}
              />
            )}

            {/* El hilo del día (Paso 4) — cards por tono, swipe Terminó/No vino,
                tap → ficha con las secundarias. La cita del hero va como referencia.
                Con el día corrido, la hora vieja va tachada y la proyectada al lado. */}
            <section aria-label="Agenda del día">
              <AppointmentThread
                appointments={appointments}
                date={date}
                timezone={timezone}
                heroAppointmentId={heroApptId}
                onMutated={() => void refresh()}
                onCompleted={openTip}
                onOpenTip={openTip}
                staffOptions={staffOptions}
                projections={projectionById}
              />
            </section>
          </>
        )}

        {tab === 'semana' && (
          <>
            <section aria-label="Vista semanal">
              <BarberWeekView anchorDate={date} todayAppointments={appointments} timezone={timezone} />
            </section>

            <section
              aria-label="Solicitar bloqueo"
              className="rounded-card border border-line bg-card px-4 py-4 shadow-card"
            >
              <BlockRequestForm initialBlockRequests={initialBlockRequests} />
            </section>

            <section
              aria-label="Horario semanal"
              className="rounded-card border border-line bg-card px-4 py-4 shadow-card"
            >
              <RecurringAvailability availability={availability} />
            </section>
          </>
        )}

        {tab === 'cierre' && (
          <section aria-label="Fin de jornada" className="space-y-4">
            {/* Tus propinas (Paso 7) — aparece en cuanto hay una cita terminada;
                junta los cabos sueltos y el acumulado. Se auto-oculta sin citas. */}
            <TipsSummary
              appointments={appointments}
              date={date}
              timezone={timezone}
              onOpenTip={openTip}
            />
            {isEndOfDay(appointments, date, timezone) ? (
              <EndOfDaySummary appointments={appointments} date={date} staffId={staffId} timezone={timezone} />
            ) : (
              <div className="rounded-card border border-line bg-card px-4 py-8 text-center shadow-card">
                <p className="text-sm text-ink-2">Tu resumen del día</p>
                <p className="mt-1 text-xs text-faint">
                  Aparece aquí cuando cierres la jornada (todas tus citas completadas o marcadas).
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      {/* ── Tab bar (mobile-first) ────────────────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card">
        <div className="mx-auto flex max-w-xl">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex-1 border-t-2 py-3 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-teal-ink text-teal-ink'
                    : 'border-transparent text-faint hover:text-ink-2'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── La hoja de propina (Paso 7) ───────────────────────────────────── */}
      {tipAppt && (
        <TipSheet
          appt={tipAppt}
          onClose={() => setTipAppt(null)}
          onSaved={() => { setTipAppt(null); void refresh(); }}
        />
      )}

      {/* ── Modal Nueva cita ──────────────────────────────────────────────── */}
      {showNewForm && (
        <NewAppointmentForm
          businessId={businessId}
          staffOptions={staffOptions}
          date={date}
          onClose={() => setShowNewForm(false)}
          onCreated={() => {
            setShowNewForm(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
