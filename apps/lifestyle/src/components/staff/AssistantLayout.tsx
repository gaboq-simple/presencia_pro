// ─── AssistantLayout ──────────────────────────────────────────────────────────
// Client Component — vista completa del asistente.
//
// Responsabilidades:
//   - Header: nombre del negocio + navegación entre días.
//   - Búsqueda de cliente (Feature 6) — debounced, pre-llena NewAppointmentForm.
//   - Botón "+ Nueva cita" → abre NewAppointmentForm.
//   - AssistantUpcoming — próximas 2 horas prominente.
//   - AssistantDayTimeline — agenda completa con cancel + notas + reagendar inline.
//   - Polling cada 30s (sin Realtime — el asistente usa ls_session sin Supabase Auth).
//   - Refresh optimista post-mutación.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import {
  refreshAssistantAppointments,
  searchCustomers,
} from '@/app/staff/assistant-actions';
import type { CustomerSearchResult } from '@/app/staff/assistant-actions';
import AssistantUpcoming from './AssistantUpcoming';
import AssistantDayTimeline from './AssistantDayTimeline';
import AvailabilityTimeline from './AvailabilityTimeline';
import NewAppointmentForm from './NewAppointmentForm';
import type { StaffBlockForDay } from '@/app/staff/assistant-actions';

// ─── Tipos locales ────────────────────────────────────────────────────────────

type StaffOption = {
  id: string;
  name: string;
};

type StaffWithAvailability = {
  id: string;
  name: string;
  availabilityToday: { start_time: string; end_time: string } | null;
};

// ─── Props ────────────────────────────────────────────────────────────────────

export type AssistantLayoutProps = {
  businessId: string;
  businessName: string;
  date: string;                                  // 'YYYY-MM-DD'
  timezone: string;                              // IANA timezone del negocio
  initialAppointments: DashboardAppointment[];
  staffOptions: StaffOption[];                   // barberos activos (para nueva cita)
  staffWithAvailability: StaffWithAvailability[];// barberos con horario (para timeline)
  initialStaffBlocks: StaffBlockForDay[];        // bloques aprobados del dia
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

function daysAgo(isoStr: string): number {
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 86_400_000);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantLayout({
  businessId,
  businessName,
  date,
  timezone,
  initialAppointments,
  staffOptions,
  staffWithAvailability,
  initialStaffBlocks,
}: AssistantLayoutProps) {
  const router = useRouter();
  const [appointments, setAppointments] =
    useState<DashboardAppointment[]>(initialAppointments);

  // Nueva cita — estado de apertura + pre-llenado desde búsqueda / slot click
  const [showNewForm, setShowNewForm]       = useState(false);
  const [prefillName, setPrefillName]       = useState('');
  const [prefillPhone, setPrefillPhone]     = useState('');
  const [prefillStaffId, setPrefillStaffId] = useState<string | undefined>();
  const [prefillTime, setPrefillTime]       = useState<string | undefined>();

  // Timeline — colapsable
  const [timelineOpen, setTimelineOpen] = useState(true);

  // Búsqueda de cliente (Feature 6)
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

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

  // ── Búsqueda debounced ────────────────────────────────────────────────────
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const timeout = setTimeout(() => {
      void searchCustomers(searchQuery).then((results) => {
        setSearchResults(results);
        setSearchLoading(false);
      });
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  // ── Navegación ────────────────────────────────────────────────────────────
  function navigate(targetDate: string) {
    router.push(`/dashboard?date=${targetDate}`);
  }

  function openFormWithPrefill(name: string, phone: string | null) {
    setPrefillName(name);
    setPrefillPhone(phone ?? '');
    setPrefillStaffId(undefined);
    setPrefillTime(undefined);
    setSearchQuery('');
    setSearchResults([]);
    setShowNewForm(true);
  }

  function openFormFromSlot(staffId: string, time: string) {
    setPrefillName('');
    setPrefillPhone('');
    setPrefillStaffId(staffId);
    setPrefillTime(time);
    setSearchQuery('');
    setSearchResults([]);
    setShowNewForm(true);
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

        {/* Búsqueda de cliente (Feature 6) */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar cliente por nombre o telefono..."
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none"
          />
          {searchLoading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              Buscando…
            </span>
          )}

          {/* Resultados de búsqueda */}
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg">
              {searchResults.map((c) => {
                const ago = c.lastVisit ? daysAgo(c.lastVisit) : null;
                return (
                  <div
                    key={c.id}
                    className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{c.name}</p>
                      {c.phone && (
                        <p className="text-xs text-gray-400">{c.phone}</p>
                      )}
                      <p className="mt-0.5 text-xs text-gray-400">
                        {c.totalVisits === 0
                          ? 'Sin visitas completadas'
                          : `${c.totalVisits} ${c.totalVisits === 1 ? 'visita' : 'visitas'}${
                              ago !== null
                                ? ` · hace ${ago} ${ago === 1 ? 'día' : 'días'}`
                                : ''
                            }${c.preferredStaff ? ` · con ${c.preferredStaff}` : ''}`}
                      </p>
                    </div>
                    <button
                      onClick={() => openFormWithPrefill(c.name, c.phone)}
                      className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                    >
                      Agendar
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sin resultados */}
          {!searchLoading && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg">
              <p className="text-xs text-gray-400">Sin resultados para "{searchQuery}"</p>
            </div>
          )}
        </div>

        {/* + Nueva cita */}
        <button
          onClick={() => {
            setPrefillName('');
            setPrefillPhone('');
            setPrefillStaffId(undefined);
            setPrefillTime(undefined);
            setSearchQuery('');
            setSearchResults([]);
            setShowNewForm(true);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-800 active:bg-gray-700"
        >
          <span className="text-lg leading-none">+</span>
          Nueva cita
        </button>

        {/* Timeline visual de disponibilidad */}
        <section aria-label="Timeline del dia">
          <div className="flex items-center justify-between px-1 pb-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Timeline
            </p>
            <button
              onClick={() => setTimelineOpen((o) => !o)}
              className="text-xs text-gray-400 hover:text-gray-600"
              aria-expanded={timelineOpen}
            >
              {timelineOpen ? '▲ Ocultar' : '▼ Ver'}
            </button>
          </div>
          {timelineOpen && (
            <AvailabilityTimeline
              appointments={appointments}
              staff={staffWithAvailability}
              staffBlocks={initialStaffBlocks}
              date={date}
              timezone={timezone}
              onSlotClick={openFormFromSlot}
            />
          )}
        </section>

        {/* Próximas 2 horas */}
        <section aria-label="Próximas 2 horas">
          <AssistantUpcoming appointments={appointments} />
        </section>

        {/* Agenda completa del día */}
        <section aria-label="Agenda del día">
          <AssistantDayTimeline
            appointments={appointments}
            date={date}
            timezone={timezone}
            onMutated={() => void refresh()}
            staffOptions={staffOptions}
          />
        </section>
      </main>

      {/* ── Modal Nueva cita ──────────────────────────────────────────────── */}
      {showNewForm && (
        <NewAppointmentForm
          businessId={businessId}
          staffOptions={staffOptions}
          date={date}
          onClose={() => {
            setShowNewForm(false);
            setPrefillName('');
            setPrefillPhone('');
            setPrefillStaffId(undefined);
            setPrefillTime(undefined);
          }}
          onCreated={() => {
            setShowNewForm(false);
            setPrefillName('');
            setPrefillPhone('');
            setPrefillStaffId(undefined);
            setPrefillTime(undefined);
            void refresh();
          }}
          defaultName={prefillName}
          defaultPhone={prefillPhone}
          defaultStaffId={prefillStaffId}
          defaultTime={prefillTime}
        />
      )}
    </div>
  );
}
