// ─── AssistantControlDesk ─────────────────────────────────────────────────────
// Client Component — mesa de control de la Recepción/Asistente (S6-UI-02).
//
// Diverge de AssistantLayout: implementa el diseño congelado
// (design-studies/asistente-FINAL.html) como una vista propia. Se monta SOLO en
// la rama role==='assistant' de dashboard/page.tsx; /staff/gestion (barbero)
// sigue usando AssistantLayout intacto.
//
// Este es el SHELL (PR-1 del cableado): estructura de dos zonas (panorama con
// scroll propio + cola de acción fija) + header con datos reales. Las piezas
// ricas llegan en sus PRs:
//   · PanoramaTimeline (carriles, ventana 3h, gesto) → PR-2/PR-3
//   · Cableado de mutaciones (reschedule/create/polling) → PR-4
//   · ActionQueue (walk-in, atrasados, sugerencias 1-tap) → PR-5
//   · Granularidad fina + pulido → PR-6
//
// Sistema visual: tokens Zentriq claro de globals.css (bg-canvas, teal, ink,
// border-line, tabular-nums…). Cero paleta numérica de Tailwind.

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import type { StaffBlockForDay } from '@/app/staff/assistant-actions';
import PanoramaTimeline from './PanoramaTimeline';

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

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantControlDesk({
  date,
  timezone,
  initialAppointments,
  staffWithAvailability,
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

  const today = isToday(date);

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
                  onClick={() => navigate(new Date().toISOString().slice(0, 10))}
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
                <b className="tabular-nums text-base">{initialAppointments.length}</b>
                <span className="text-xs text-faint">Citas hoy</span>
              </div>
              <div className="flex flex-col leading-tight">
                <b className="tabular-nums text-base">{staffWithAvailability.length}</b>
                <span className="text-xs text-faint">Barberos</span>
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
                appointments={initialAppointments}
                staff={staffWithAvailability}
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
    </div>
  );
}
