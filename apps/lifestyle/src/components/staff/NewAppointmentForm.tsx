// ─── NewAppointmentForm ───────────────────────────────────────────────────────
// Formulario rápido para crear citas desde la vista del asistente.
//
// Flujo:
//   1. Carga catálogo de servicios (GET /api/catalog?businessId=)
//   2. Asistente elige: canal, nombre del cliente, teléfono (opcional),
//      servicio, barbero, hora.
//   3. endsAt se calcula automáticamente: startsAt + duration_minutes.
//   4. Submit → createAssistantAppointment (Server Action).
//   5. onCreated() callback → AssistantLayout refresca las citas.
//
// Diseño: modal tipo sheet fijo en la parte inferior (mobile-first).

'use client';

import { useState, useEffect } from 'react';
import { createAssistantAppointment } from '@/app/staff/assistant-actions';

// ─── Tipos locales ────────────────────────────────────────────────────────────

type ServiceOption = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  currency: string;
};

type StaffOption = {
  id: string;
  name: string;
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  businessId: string;
  staffOptions: StaffOption[];  // barberos activos pasados desde el servidor
  date: string;                 // 'YYYY-MM-DD' — fecha del día actual
  onClose: () => void;
  onCreated: () => void;        // callback — dispara refresh
  defaultName?: string;         // pre-llenado desde búsqueda de cliente (Feature 6)
  defaultPhone?: string;        // pre-llenado desde búsqueda de cliente (Feature 6)
  defaultStaffId?: string;      // pre-llenado desde click en slot del timeline
  defaultTime?: string;         // 'HH:MM' — pre-llenado desde click en slot del timeline
};

// ─── Config ───────────────────────────────────────────────────────────────────

const SOURCE_LABELS = {
  walkin:  'Walk-in (presencial)',
  llamada: 'Llamada telefónica',
  manual:  'Manual (agenda/otro)',
} as const;

type Source = keyof typeof SOURCE_LABELS;

// ─── Helper: hora local redondeada a 15 min ───────────────────────────────────

function defaultStartTime(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d.toTimeString().slice(0, 5); // 'HH:MM'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewAppointmentForm({
  businessId,
  staffOptions,
  date,
  onClose,
  onCreated,
  defaultName = '',
  defaultPhone = '',
  defaultStaffId,
  defaultTime,
}: Props) {
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);

  const [source, setSource]               = useState<Source>('walkin');
  const [customerName, setCustomerName]   = useState(defaultName);
  const [customerPhone, setCustomerPhone] = useState(defaultPhone);
  const [serviceId, setServiceId]         = useState('');
  const [staffId, setStaffId]             = useState(defaultStaffId ?? staffOptions[0]?.id ?? '');
  const [startTime, setStartTime]         = useState(defaultTime ?? defaultStartTime);
  const [notes, setNotes]                 = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  // Cargar catálogo
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/catalog?businessId=${businessId}`, {
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error('Error al cargar servicios');
        const body = (await res.json()) as { services: ServiceOption[] };
        setServices(body.services);
        if (body.services[0]) setServiceId(body.services[0].id);
      } catch {
        setError('No se pudo cargar el catálogo de servicios');
      } finally {
        setLoadingServices(false);
      }
    })();
  }, [businessId]);

  const selectedService = services.find((s) => s.id === serviceId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerName.trim()) {
      setError('El nombre del cliente es obligatorio');
      return;
    }
    if (!serviceId || !staffId || !startTime) {
      setError('Completa todos los campos requeridos');
      return;
    }
    if (!selectedService) {
      setError('Selecciona un servicio válido');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const [hh, mm] = startTime.split(':').map(Number);
      const startDate = new Date(`${date}T00:00:00`);
      startDate.setHours(hh ?? 0, mm ?? 0, 0, 0);
      const endDate = new Date(
        startDate.getTime() + selectedService.duration_minutes * 60_000,
      );

      const tzOffset = -startDate.getTimezoneOffset();
      const sign = tzOffset >= 0 ? '+' : '-';
      const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
      const offsetStr = `${sign}${pad(Math.floor(Math.abs(tzOffset) / 60))}:${pad(Math.abs(tzOffset) % 60)}`;

      function toIsoLocal(d: Date): string {
        const y   = d.getFullYear();
        const mo  = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const h   = pad(d.getHours());
        const mi  = pad(d.getMinutes());
        const s   = pad(d.getSeconds());
        return `${y}-${mo}-${day}T${h}:${mi}:${s}${offsetStr}`;
      }

      const res = await createAssistantAppointment({
        staffId,
        serviceId,
        startsAt:      toIsoLocal(startDate),
        endsAt:        toIsoLocal(endDate),
        source,
        notes:         notes.trim() || undefined,
        customerName:  customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
      });

      // Validaciones de cara al usuario (tope, teléfono) vienen como { error }
      // — no se redactan en prod, a diferencia de un throw.
      if (res?.error) {
        setError(res.error);
        setSubmitting(false);
        return;
      }

      onCreated();
    } catch (err) {
      // Errores inesperados del sistema (se redactan en prod, está bien).
      setError(err instanceof Error ? err.message : 'Error al crear la cita');
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-20 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-xl rounded-t-2xl bg-white px-4 pb-8 pt-4 shadow-2xl">
        {/* Handle */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-200" />

        {/* Título */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Nueva cita</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {loadingServices ? (
          <p className="py-8 text-center text-sm text-gray-400">Cargando servicios…</p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            {/* Canal */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Canal</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.entries(SOURCE_LABELS) as [Source, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSource(key)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                      source === key
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Nombre del cliente — OBLIGATORIO */}
            <div>
              <label htmlFor="na-cname" className="mb-1 block text-xs font-medium text-gray-600">
                Nombre del cliente <span className="text-red-500">*</span>
              </label>
              <input
                id="na-cname"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={120}
                placeholder="Nombre completo"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                required
                autoFocus
              />
            </div>

            {/* Telefono — opcional */}
            <div>
              <label htmlFor="na-phone" className="mb-1 block text-xs font-medium text-gray-600">
                Telefono <span className="font-normal text-gray-400">(opcional)</span>
              </label>
              <input
                id="na-phone"
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                maxLength={20}
                placeholder="Para clientes recurrentes"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              />
            </div>

            {/* Servicio */}
            <div>
              <label htmlFor="na-service" className="mb-1 block text-xs font-medium text-gray-600">
                Servicio
              </label>
              <select
                id="na-service"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                required
              >
                <option value="">Seleccionar…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.duration_minutes} min
                  </option>
                ))}
              </select>
            </div>

            {/* Barbero */}
            <div>
              <label htmlFor="na-staff" className="mb-1 block text-xs font-medium text-gray-600">
                Barbero
              </label>
              <select
                id="na-staff"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                required
              >
                <option value="">Seleccionar…</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Hora */}
            <div>
              <label htmlFor="na-time" className="mb-1 block text-xs font-medium text-gray-600">
                Hora de inicio
              </label>
              <input
                id="na-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
                required
              />
              {selectedService && (
                <p className="mt-0.5 text-xs text-gray-400">
                  Duración: {selectedService.duration_minutes} min
                </p>
              )}
            </div>

            {/* Notas adicionales (opcional) */}
            <div>
              <label htmlFor="na-notes" className="mb-1 block text-xs font-medium text-gray-600">
                Notas adicionales <span className="font-normal text-gray-400">(opcional)</span>
              </label>
              <textarea
                id="na-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Preferencias, observaciones…"
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-600">{error}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !serviceId || !staffId || !customerName.trim()}
              className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {submitting ? 'Creando…' : 'Crear cita'}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
