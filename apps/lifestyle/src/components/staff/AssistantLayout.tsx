// ─── AssistantLayout ──────────────────────────────────────────────────────────
// Client Component — vista completa del asistente.
//
// Responsabilidades:
//   - Header: nombre del negocio + navegación entre días.
//   - Botón "+ Nueva cita" → abre NewAppointmentForm.
//   - AssistantUpcoming — próximas 2 horas prominente.
//   - AssistantDayTimeline — agenda completa con cancel + notas inline.
//   - Polling cada 30s (sin Realtime — el asistente usa ls_session sin Supabase Auth).
//   - Refresh optimista post-mutación.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import { refreshAssistantAppointments } from '@/app/staff/assistant-actions';
import AssistantUpcoming from './AssistantUpcoming';
import AssistantDayTimeline from './AssistantDayTimeline';
import NewAppointmentForm from './NewAppointmentForm';

// ─── Tipos locales ────────────────────────────────────────────────────────────

type StaffOption = {
  id: string;
  name: string;
};

// ─── Props ────────────────────────────────────────────────────────────────────

export type AssistantLayoutProps = {
  businessId: string;
  businessName: string;
  date: string;                                  // 'YYYY-MM-DD'
  initialAppointments: DashboardAppointment[];
  staffOptions: StaffOption[];                   // barberos activos (para nueva cita)
};

// ─── Config ───────────────────────────────────────────────────────────────────

const POLL_MS = 30_000; // 30 segundos

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

export default function AssistantLayout({
  businessId,
  businessName,
  date,
  initialAppointments,
  staffOptions,
}: AssistantLayoutProps) {
  const router = useRouter();
  const [appointments, setAppointments] =
    useState<DashboardAppointment[]>(initialAppointments);
  const [showNewForm, setShowNewForm] = useState(false);

  // Ref para leer la fecha sin causar re-suscripción del intervalo
  const dateRef = useRef(date);
  dateRef.current = date;

  // ── Refresh ───────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    const fresh = await refreshAssistantAppointments(dateRef.current);
    setAppointments(fresh);
  }, []);

  // ── Polling cada 30s ──────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // ── Sincronizar al navegar entre días ─────────────────────────────────────
  useEffect(() => {
    setAppointments(initialAppointments);
  }, [date, initialAppointments]);

  // ── Navegación ────────────────────────────────────────────────────────────
  function navigate(targetDate: string) {
    router.push(`/dashboard?date=${targetDate}`);
  }

  const prevDate  = addDays(date, -1);
  const nextDate  = addDays(date, +1);
  const todayDate = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 py-3">
        <div className="mx-auto max-w-xl">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {businessName}
          </p>

          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              onClick={() => navigate(prevDate)}
              aria-label="Día anterior"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 active:bg-gray-100"
            >
              ‹
            </button>

            <div className="text-center">
              <p className="text-sm font-semibold capitalize text-gray-900">
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
        </div>
      </header>

      {/* ── Cuerpo ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-xl space-y-4 px-4 pb-12 pt-4">

        {/* + Nueva cita */}
        <button
          onClick={() => setShowNewForm(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-800 active:bg-gray-700"
        >
          <span className="text-lg leading-none">+</span>
          Nueva cita
        </button>

        {/* Próximas 2 horas */}
        <section aria-label="Próximas 2 horas">
          <AssistantUpcoming appointments={appointments} />
        </section>

        {/* Agenda completa del día */}
        <section aria-label="Agenda del día">
          <AssistantDayTimeline
            appointments={appointments}
            date={date}
            onMutated={() => void refresh()}
          />
        </section>
      </main>

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
