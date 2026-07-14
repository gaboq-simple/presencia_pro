// ─── ServicesManagementPanel ──────────────────────────────────────────────────
// Client Component — gestión del catálogo de servicios para el owner/admin.
//
// Molde: StaffManagementPanel — lista con acciones optimistas (rollback on fail)
// y modal hand-rolled (fixed inset-0 z-50 bg-black/40, cierre por backdrop) que
// hospeda el ServiceForm de crear/editar.
//
// Acciones:
//   - Crear servicio    → POST /api/services
//   - Editar servicio   → PATCH /api/services/[id]
//   - Desactivar/reactivar (soft-delete) → PATCH /api/services/[id] { active }
//     Desactivar un servicio con citas futuras pide confirmación (no bloquea).

'use client';

import { useState } from 'react';
import type { AdminServiceRow } from '@/lib/dashboard.types';
import ServiceForm, { type ServiceMutationResult } from './ServiceForm';

type Props = {
  initialServices: AdminServiceRow[];
};

type ModalState =
  | { type: 'create' }
  | { type: 'edit'; service: AdminServiceRow }
  | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function priceLabel(s: AdminServiceRow): string {
  if (s.price_min != null && s.price_max != null) {
    return `${formatMoney(s.price_min, s.currency)}–${formatMoney(s.price_max, s.currency)}`;
  }
  return formatMoney(s.price, s.currency);
}

function sortServices(list: AdminServiceRow[]): AdminServiceRow[] {
  return [...list].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name, 'es');
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ServicesManagementPanel({ initialServices }: Props) {
  const [services, setServices]         = useState<AdminServiceRow[]>(() => sortServices(initialServices));
  const [loadingId, setLoadingId]       = useState<string | null>(null);
  const [modal, setModal]               = useState<ModalState>(null);
  const [pendingOff, setPendingOff]     = useState<AdminServiceRow | null>(null);

  // ── Toggle active (optimista + rollback) ───────────────────────────────────

  async function performToggle(service: AdminServiceRow) {
    if (loadingId) return;
    setLoadingId(service.id);

    const newActive = !service.active;
    setServices((prev) =>
      sortServices(prev.map((s) => (s.id === service.id ? { ...s, active: newActive } : s))),
    );

    try {
      const res = await fetch(`/api/services/${service.id}`, {
        method:      'PATCH',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify({ active: newActive }),
      });
      if (!res.ok) {
        // rollback
        setServices((prev) =>
          sortServices(prev.map((s) => (s.id === service.id ? { ...s, active: service.active } : s))),
        );
      }
    } catch {
      setServices((prev) =>
        sortServices(prev.map((s) => (s.id === service.id ? { ...s, active: service.active } : s))),
      );
    } finally {
      setLoadingId(null);
    }
  }

  function onToggleClick(service: AdminServiceRow) {
    // Desactivar un servicio con citas futuras ⇒ pedir confirmación (no bloquea).
    if (service.active && service.upcomingCount > 0) {
      setPendingOff(service);
      return;
    }
    void performToggle(service);
  }

  // ── Guardado del form ──────────────────────────────────────────────────────

  function handleSaved(saved: ServiceMutationResult) {
    setServices((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id);
      if (idx === -1) {
        // Creado — upcomingCount = 0 (recién nace)
        return sortServices([...prev, { ...saved, upcomingCount: 0 }]);
      }
      // Editado — conservar upcomingCount del server
      const merged = prev.map((s) => (s.id === saved.id ? { ...saved, upcomingCount: s.upcomingCount } : s));
      return sortServices(merged);
    });
    setModal(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Botón crear */}
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setModal({ type: 'create' })}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
        >
          + Nuevo servicio
        </button>
      </div>

      {services.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-400">
          Aún no hay servicios. Crea el primero con “+ Nuevo servicio”.
        </p>
      ) : (
        <div className="space-y-2">
          {services.map((svc) => {
            const isLoading = loadingId === svc.id;
            return (
              <div
                key={svc.id}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  svc.active ? 'border-gray-100 bg-white' : 'border-gray-100 bg-gray-50'
                }`}
              >
                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`truncate text-sm font-medium ${svc.active ? 'text-gray-900' : 'text-gray-400'}`}>
                      {svc.name}
                    </p>
                    {!svc.active && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">
                        Inactivo
                      </span>
                    )}
                  </div>
                  <p className={`mt-0.5 text-xs ${svc.active ? 'text-gray-500' : 'text-gray-400'}`}>
                    <span className="tabular-nums">{priceLabel(svc)}</span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span className="tabular-nums">{svc.duration_minutes} min</span>
                    {svc.upcomingCount > 0 && (
                      <>
                        <span className="mx-1.5 text-gray-300">·</span>
                        <span>{svc.upcomingCount} cita{svc.upcomingCount === 1 ? '' : 's'} próxima{svc.upcomingCount === 1 ? '' : 's'}</span>
                      </>
                    )}
                  </p>

                  {/* Acción editar */}
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'edit', service: svc })}
                      disabled={!!modal}
                      className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                        <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81 3.25 11.31a.25.25 0 00-.064.108l-.65 2.278 2.278-.65a.25.25 0 00.108-.064L11.19 6.25z" />
                      </svg>
                      Editar
                    </button>
                  </div>
                </div>

                {/* Toggle activo */}
                <button
                  type="button"
                  onClick={() => onToggleClick(svc)}
                  disabled={isLoading}
                  title={svc.active ? 'Desactivar' : 'Reactivar'}
                  aria-label={`${svc.active ? 'Desactivar' : 'Reactivar'} ${svc.name}`}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50 ${
                    svc.active ? 'bg-gray-800' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      svc.active ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal crear/editar ──────────────────────────────────────────────── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div
            className="w-full max-w-md overflow-y-auto rounded-t-2xl bg-white px-5 pb-8 pt-5 shadow-xl sm:rounded-2xl"
            style={{ maxHeight: '90vh' }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                {modal.type === 'create' ? 'Nuevo servicio' : 'Editar servicio'}
              </h2>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                  <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                </svg>
              </button>
            </div>

            <ServiceForm
              initial={modal.type === 'edit' ? modal.service : undefined}
              onSaved={handleSaved}
              onCancel={() => setModal(null)}
            />
          </div>
        </div>
      )}

      {/* ── Confirmación de desactivar con citas futuras ────────────────────── */}
      {pendingOff && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) setPendingOff(null); }}
        >
          <div className="w-full max-w-sm rounded-t-2xl bg-white px-5 pb-6 pt-5 shadow-xl sm:rounded-2xl">
            <h2 className="text-sm font-semibold text-gray-900">Desactivar “{pendingOff.name}”</h2>
            <p className="mt-2 text-xs leading-relaxed text-gray-600">
              Este servicio tiene{' '}
              <span className="font-semibold text-gray-800">
                {pendingOff.upcomingCount} cita{pendingOff.upcomingCount === 1 ? '' : 's'} próxima{pendingOff.upcomingCount === 1 ? '' : 's'}
              </span>. Desactivarlo <span className="font-medium">no</span> las cancela, pero el bot dejará de
              ofrecerlo y no se podrá agendar de nuevo. ¿Continuar?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { const s = pendingOff; setPendingOff(null); void performToggle(s); }}
                className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white"
              >
                Sí, desactivar
              </button>
              <button
                type="button"
                onClick={() => setPendingOff(null)}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
