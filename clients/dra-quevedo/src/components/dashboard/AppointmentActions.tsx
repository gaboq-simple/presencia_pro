'use client';

// ─── AppointmentActions ────────────────────────────────────────────────────────
// Renders Modificar + Cancelar buttons for actionable appointments.
// Manages local modal state — opens CancelAppointmentModal or RescheduleModal.
// Injected into DayView via the renderExtraActions render prop.
//
// Only visible for status: pending | pending_confirmation | confirmed.
// Terminal and blocked statuses show nothing (guard in DayView canAct block).

import { useState } from 'react';
import { Pencil, XCircle } from 'lucide-react';
import type { AppointmentWithPatient } from '@presenciapro/engine/dashboard';
import { CancelAppointmentModal } from './CancelAppointmentModal';
import { RescheduleModal } from './RescheduleModal';

// ─── Types ─────────────────────────────────────────────────────────────────────

type OpenModal = 'reschedule' | 'cancel' | null;

type Props = {
  readonly appointment: AppointmentWithPatient;
  readonly onUpdate: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AppointmentActions({ appointment, onUpdate }: Props) {
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  function closeModal() {
    setOpenModal(null);
  }

  function handleSuccess() {
    setOpenModal(null);
    onUpdate();
  }

  return (
    <>
      {/* ── Buttons ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.625rem',
        }}
      >
        <button
          onClick={() => setOpenModal('reschedule')}
          title="Modificar fecha y hora"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.375rem',
            padding: '0.5rem',
            backgroundColor: 'transparent',
            color: 'var(--color-ink)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Pencil size={14} />
          Modificar
        </button>

        <button
          onClick={() => setOpenModal('cancel')}
          title="Cancelar cita"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.375rem',
            padding: '0.5rem',
            backgroundColor: 'transparent',
            color: '#B91C1C',
            border: '1px solid #FECACA',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <XCircle size={14} />
          Cancelar
        </button>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {openModal === 'cancel' && (
        <CancelAppointmentModal
          appointment={appointment}
          onSuccess={handleSuccess}
          onClose={closeModal}
        />
      )}

      {openModal === 'reschedule' && (
        <RescheduleModal
          appointment={appointment}
          onSuccess={handleSuccess}
          onClose={closeModal}
        />
      )}
    </>
  );
}
