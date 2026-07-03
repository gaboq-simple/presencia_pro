// ─── StaffLayout ─────────────────────────────────────────────────────────────
// Client Component — orquesta toda la vista del barbero.
//
// Responsabilidades:
//   - Header: nombre + fecha formateada + navegación entre días.
//   - Suscripción Realtime a sus citas del día (filtrado por staff_id).
//     · INSERT → refetch + agregar al estado ordenado.
//     · UPDATE → refetch + reemplazar en el estado.
//     · DELETE → eliminar del estado por id.
//   - Limpia el canal en unmount (supabase.removeChannel).
//   - Resetea appointments cuando cambia la fecha (nueva navegación).
//   - Distribuye estado a NextClientCard y StaffDayTimeline.
//   - Renderiza BlockRequestForm y RecurringAvailability con sus datos fijos.

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type {
  DayAppointmentForStaff,
  StaffAvailabilitySlot,
  StaffBlockRequest,
} from '@/lib/dashboard.types';
import NextClientCard from './NextClientCard';
import ClientProfileCard from './ClientProfileCard';
import StaffDayTimeline from './StaffDayTimeline';
import EndOfDaySummary from './EndOfDaySummary';
import BarberWeekView from './BarberWeekView';
import BlockRequestForm from './BlockRequestForm';
import RecurringAvailability from './RecurringAvailability';

// ─── Props ────────────────────────────────────────────────────────────────────

export type StaffLayoutProps = {
  staffId: string;
  staffName: string;
  businessId: string;
  date: string;                              // 'YYYY-MM-DD'
  initialAppointments: DayAppointmentForStaff[];
  availability: StaffAvailabilitySlot[];
  initialBlockRequests: StaffBlockRequest[];
  upcomingCustomerId: string | null;         // cliente con cita en las próximas 2h
  /** role controla secciones exclusivas de barbero; default 'barber' */
  role?: 'barber' | 'assistant';
};

// ─── Realtime row (plano, sin joins) ─────────────────────────────────────────

type AppointmentRowMin = {
  id: string;
  starts_at: string;
};

// ─── Helper: refetch de una cita con todos sus joins ─────────────────────────
// Usa browser client (anon key + sesión). RLS garantiza que el barbero
// solo puede leer sus propias citas.

async function fetchAppointmentById(
  id: string,
): Promise<DayAppointmentForStaff | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      starts_at,
      ends_at,
      status,
      source,
      service:service_id(id, name, duration_minutes),
      customer:customer_id(id, name, phone)
    `)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as DayAppointmentForStaff;
}

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

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Helper: customer_id de la cita próxima en las siguientes 2 horas ─────────
// Rederiva reactivamente del estado de appointments (cubre actualizaciones Realtime).

function deriveUpcomingCustomerId(
  appointments: DayAppointmentForStaff[],
): string | null {
  const now = Date.now();
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const found = appointments.find((a) => {
    if (!a.customer?.id) return false;
    const startsAt = new Date(a.starts_at).getTime();
    return startsAt >= now && startsAt <= now + twoHoursMs;
  });
  return found?.customer?.id ?? null;
}

type StaffView = 'day' | 'week';

export default function StaffLayout({
  staffId,
  staffName,
  businessId: _businessId,
  date,
  initialAppointments,
  availability,
  initialBlockRequests,
  upcomingCustomerId: _upcomingCustomerIdProp,
  role = 'barber',
}: StaffLayoutProps) {
  const router = useRouter();

  const [appointments, setAppointments] =
    useState<DayAppointmentForStaff[]>(initialAppointments);
  const [syncedDate, setSyncedDate] = useState(date);
  if (syncedDate !== date) {
    setSyncedDate(date);
    setAppointments(initialAppointments);
  }

  // Vista activa — solo relevante para role='barber'
  const [view, setView] = useState<StaffView>('day');

  // Ref para leer la fecha actual dentro del callback de Realtime
  // sin causar que el effect se re-suscriba al navegar entre días.
  const dateRef = useRef(date);
  useEffect(() => { dateRef.current = date; });

  // ── Suscripción Realtime — citas del barbero ────────────────────────────────
  // Solo activa cuando role='barber' y hay staffId válido.
  // El asistente recibe los datos iniciales del servidor (sin Realtime en Bloque A).
  useEffect(() => {
    if (role !== 'barber' || !staffId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`staff-appointments-${staffId}`)
      .on<AppointmentRowMin>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `staff_id=eq.${staffId}`,
        },
        async (payload: RealtimePostgresChangesPayload<AppointmentRowMin>) => {
          const currentDate = dateRef.current;

          if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            if (deletedId) {
              setAppointments((prev) => prev.filter((a) => a.id !== deletedId));
            }
            return;
          }

          const newRow = payload.new;
          if (!newRow.id || !newRow.starts_at) return;

          // Ignorar citas fuera del día que se está viendo
          const apptDate = newRow.starts_at.slice(0, 10);
          if (apptDate !== currentDate) return;

          const updated = await fetchAppointmentById(newRow.id);
          if (!updated) return;

          if (payload.eventType === 'INSERT') {
            setAppointments((prev) => {
              const withNew = [...prev, updated];
              return withNew.sort((a, b) =>
                a.starts_at.localeCompare(b.starts_at),
              );
            });
          } else {
            // UPDATE
            setAppointments((prev) =>
              prev.map((a) => (a.id === updated.id ? updated : a)),
            );
          }
        },
      )
      .subscribe();

    // Cleanup — libera el canal al desmontar o cuando cambia staffId
    return () => {
      supabase.removeChannel(channel);
    };
  }, [staffId, role]);

  // ── Navegación entre días ─────────────────────────────────────────────────

  function navigate(targetDate: string) {
    router.push(`/staff?date=${targetDate}`);
  }

  // Rederiva reactivamente del estado (cubre actualizaciones Realtime)
  const upcomingCustomerId = deriveUpcomingCustomerId(appointments);

  const prevDate  = addDays(date, -1);
  const nextDate  = addDays(date, +1);
  const todayDate = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 py-3">
        <div className="mx-auto max-w-xl">
          {/* Nombre + toggle Hoy/Semana */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              {staffName}
            </p>

            {/* Toggle + link gestion — solo para barberos */}
            {role === 'barber' && (
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-gray-200 p-0.5">
                  {(['day', 'week'] as StaffView[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        view === v
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {v === 'day' ? 'Hoy' : 'Semana'}
                    </button>
                  ))}
                </div>
                <a
                  href="/staff/gestion"
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  title="Vista de gestion"
                >
                  Gestion →
                </a>
              </div>
            )}
          </div>

          {/* Navegación de días — solo en vista día */}
          {view === 'day' && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <button
                onClick={() => navigate(prevDate)}
                aria-label="Día anterior"
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 active:bg-gray-100"
              >
                ‹
              </button>

              <div className="text-center">
                <p className="text-sm font-semibold text-gray-900 capitalize">
                  {formatDateHeader(date)}
                </p>
                {!isToday(date) && (
                  <button
                    onClick={() => navigate(todayDate)}
                    className="mt-0.5 text-xs text-gray-400 underline hover:text-gray-600"
                  >
                    Ir a hoy
                  </button>
                )}
              </div>

              <button
                onClick={() => navigate(nextDate)}
                aria-label="Día siguiente"
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 active:bg-gray-100"
              >
                ›
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Cuerpo ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-xl space-y-4 px-4 pb-12 pt-4">

        {view === 'week' ? (
          /* ── Vista semanal ─────────────────────────────────────────────── */
          <section aria-label="Vista semanal">
            <BarberWeekView
              anchorDate={date}
              todayAppointments={appointments}
            />
          </section>
        ) : (
          /* ── Vista diaria (default) ────────────────────────────────────── */
          <>
            {/* Resumen de fin de día — visible solo cuando no quedan citas activas */}
            <EndOfDaySummary appointments={appointments} date={date} staffId={staffId} />

            {/* Ficha contextual del cliente — solo si hay cita en las próximas 2h */}
            {upcomingCustomerId && (
              <ClientProfileCard customerId={upcomingCustomerId} />
            )}

            {/* Próximo cliente */}
            <NextClientCard appointments={appointments} date={date} />

            {/* Agenda del día */}
            <section aria-label="Agenda del día">
              <StaffDayTimeline appointments={appointments} date={date} />
            </section>
          </>
        )}

        {/* ── Sección bottom: solo para barberos (no para asistentes) ──── */}
        {role === 'barber' && (
          <>
            <section
              aria-label="Solicitar bloqueo"
              className="rounded-xl border border-gray-100 bg-white px-4 py-4"
            >
              <BlockRequestForm initialBlockRequests={initialBlockRequests} />
            </section>

            <section
              aria-label="Horario semanal"
              className="rounded-xl border border-gray-100 bg-white px-4 py-4"
            >
              <RecurringAvailability availability={availability} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
