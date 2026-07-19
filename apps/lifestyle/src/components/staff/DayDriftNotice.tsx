// ─── DayDriftNotice — "Tu día se corrió N min" (Paso 6) ──────────────────────
// El aviso NEUTRO de arriba del hilo cuando el día va corrido. Regla de tono (no
// negociable, decisión de producto): el atraso es un dato sobre EL DÍA, no un
// reproche al barbero. Sujeto = "el día". Gris/neutro: tokens de card estándar
// (bg-card, border-line, text-ink/ink-2), tabular-nums. PROHIBIDO: ámbar de
// alarma, "vas atrasado", íconos de warning, cualquier cosa que apure.
//
// "Avisarles" (Opción A — decisión Gabriel, Paso 6): NO hay envío saliente
// automático todavía (necesita plantilla aprobada por Meta + manejo de
// respuestas — es un producto aparte). Para no dejar una promesa falsa en la UI,
// el botón abre una ficha con los clientes afectados y su hora nueva, y por cada
// uno un link wa.me PRELLENADO (mismo patrón de contacto que AppointmentSheet,
// Paso 4): se abre el WhatsApp del barbero con el mensaje listo — el aviso sale
// de verdad, con su pulgar. Nada se simula.
//
// TODO(mensajería saliente): cuando exista el envío automático (plantilla Meta
// aprobada), este es el punto de enganche — reemplazar los links wa.me por un
// server action que recalcule el corrimiento server-side y envíe vía
// sendWhatsAppMeta (patrón cancelAppointment: envío + fila de log en
// scheduled_notifications), manteniendo esta ficha como confirmación previa.

'use client';

import { useState } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import type { DriftProjection } from '@/lib/dayDrift';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  /** Proyecciones ya filtradas por el umbral (StaffLayout aplica DRIFT_THRESHOLD_MIN). */
  projections: DriftProjection[];
  appointments: DashboardAppointment[];
  timezone: string;
  nowMs: number;
  driftMin: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hhmmFromMs(msEpoch: number, tz: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(msEpoch));
}

function firstName(full: string): string {
  return full.split(' ')[0] ?? full;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DayDriftNotice({ projections, appointments, timezone, nowMs, driftMin }: Props) {
  const [showSheet, setShowSheet] = useState(false);
  // Feedback local honesto: marca los chats que el barbero YA abrió (no un "enviado").
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const byId = new Map(appointments.map((a) => [a.id, a]));

  // Solo entradas por venir: una proyección cuyo instante ya pasó (el cliente ya
  // debería estar en la silla) no se anuncia — la card del hilo ya cuenta esa parte.
  const upcoming = projections
    .map((p) => ({ p, appt: byId.get(p.apptId) }))
    .filter((x): x is { p: DriftProjection; appt: DashboardAppointment } => !!x.appt)
    .filter((x) => x.p.projectedStartMs >= nowMs);

  if (upcoming.length === 0) return null;

  const resumen = upcoming
    .slice(0, 3)
    .map((x) => `${firstName(x.appt.customer?.name ?? 'Cliente')} entra ${hhmmFromMs(x.p.projectedStartMs, timezone)}`)
    .join(', ');

  return (
    <>
      <section
        aria-label="El día se corrió"
        className="rounded-card border border-line bg-card px-4 py-3 shadow-card"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tabular-nums text-ink">
              Tu día se corrió {driftMin} min
            </p>
            <p className="mt-0.5 truncate text-xs tabular-nums text-ink-2">{resumen}</p>
          </div>
          <button
            onClick={() => setShowSheet(true)}
            className="shrink-0 rounded-xl border border-line bg-card px-3.5 py-2 text-sm font-semibold text-ink-2 hover:bg-tint-1 active:bg-tint-2"
          >
            Avisarles
          </button>
        </div>
      </section>

      {/* ── Ficha "Avisarles" ─────────────────────────────────────────────── */}
      {showSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30"
          onClick={() => setShowSheet(false)}
        >
          <div
            className="animate-card-in max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-t-card border border-line bg-card px-4 pb-8 pt-3 shadow-hero"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />

            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-semibold text-ink">Avisarles</p>
                <p className="mt-0.5 text-sm text-ink-2">
                  El día se corrió {driftMin} min — estas son las horas nuevas.
                </p>
              </div>
              <button
                onClick={() => setShowSheet(false)}
                aria-label="Cerrar"
                className="shrink-0 rounded-lg px-2 py-1 text-ink-2 hover:bg-past-bg"
              >
                ✕
              </button>
            </div>

            <ul className="mt-4 space-y-2">
              {upcoming.map(({ p, appt }) => {
                const name = appt.customer?.name ?? 'Cliente';
                const phoneRaw = appt.customer?.phone ?? '';
                const oldTime = hhmmFromMs(p.scheduledStartMs, timezone);
                const newTime = hhmmFromMs(p.projectedStartMs, timezone);
                const msg = `Hola ${firstName(name)} — se nos corrió un poco el día por acá. Tu cita de las ${oldTime} pasaría a las ${newTime}. ¡Gracias por la paciencia!`;
                const waHref = phoneRaw
                  ? `https://wa.me/${phoneRaw.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`
                  : null;
                const wasOpened = opened.has(appt.id);

                return (
                  <li
                    key={appt.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{name}</p>
                      <p className="text-xs tabular-nums text-ink-2">
                        <span className="text-past-faint line-through">{oldTime}</span>
                        <span className="mx-1.5 text-faint" aria-hidden="true">→</span>
                        {newTime}
                      </p>
                    </div>
                    {waHref ? (
                      wasOpened ? (
                        <span className="shrink-0 text-xs font-semibold text-teal-ink">Chat abierto ✓</span>
                      ) : (
                        <a
                          href={waHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setOpened((s) => new Set(s).add(appt.id))}
                          className="shrink-0 rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold text-teal-ink hover:bg-tint-1"
                        >
                          Avisarle
                        </a>
                      )
                    ) : (
                      <span className="shrink-0 text-xs text-faint">Sin teléfono</span>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Honestidad de la promesa: acá no hay envío automático — se abre TU
                WhatsApp con el mensaje listo. */}
            <p className="mt-3 text-xs leading-relaxed text-faint">
              Se abre tu WhatsApp con el mensaje listo para cada cliente. El aviso
              automático llegará cuando activemos la mensajería saliente.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
