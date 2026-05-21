// ─── StaffManagementPanel ─────────────────────────────────────────────────────
// Client Component — gestión de staff para el owner/admin.
//
// Funciones:
//   - Listar todo el staff (activos + inactivos) con foto/iniciales, nombre, rol.
//   - Toggle active/inactive — PATCH /api/staff/[id]/manage { active }
//   - PIN visible + editable inline — PATCH /api/staff/[id]/manage { pin }
//     Solo aplica a role='barber'. Admins/asistentes acceden por token, no PIN.
//   - Editar horario base — abre StaffScheduleEditor en modal overlay.
//     Carga disponibilidad actual via GET /api/staff/[id]/schedule.
//   - Dia libre — abre QuickDayOff en modal overlay.
//     POST /api/staff/[id]/day-off con status='approved' inmediato.
//
// Estado local — optimistic updates para toggle y PIN.
// Modal: overlay fijo con backdrop semitransparente (sin dependencias externas).

'use client';

import { useState, useRef, useCallback } from 'react';
import type { AdminStaffManagementRow, StaffAvailabilitySlot } from '@/lib/dashboard.types';
import StaffScheduleEditor from './StaffScheduleEditor';
import QuickDayOff from './QuickDayOff';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  initialStaff: AdminStaffManagementRow[];
};

// ─── Modal state ──────────────────────────────────────────────────────────────

type ModalState =
  | { type: 'schedule'; staffId: string; staffName: string; availability: StaffAvailabilitySlot[] }
  | { type: 'dayoff';   staffId: string; staffName: string }
  | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  barber:    'Barbero',
  assistant: 'Asistente',
  admin:     'Admin',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffManagementPanel({ initialStaff }: Props) {
  const [staff, setStaff] = useState<AdminStaffManagementRow[]>(initialStaff);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pinEditId, setPinEditId]   = useState<string | null>(null);
  const [pinValue, setPinValue]     = useState('');
  const [pinError, setPinError]     = useState<string | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  const [modal, setModal]                     = useState<ModalState>(null);
  const [scheduleLoadingId, setScheduleLoadingId] = useState<string | null>(null);
  const [scheduleError, setScheduleError]         = useState<{ id: string; msg: string } | null>(null);

  // ── Toggle active ─────────────────────────────────────────────────────────

  async function toggleActive(member: AdminStaffManagementRow) {
    if (loadingId) return;
    setLoadingId(member.id);

    // Optimistic update
    const newActive = !member.active;
    setStaff((prev) =>
      prev.map((s) => (s.id === member.id ? { ...s, active: newActive } : s)),
    );

    try {
      const res = await fetch(`/api/staff/${member.id}/manage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ active: newActive }),
      });

      if (!res.ok) {
        setStaff((prev) =>
          prev.map((s) => (s.id === member.id ? { ...s, active: member.active } : s)),
        );
      }
    } catch {
      setStaff((prev) =>
        prev.map((s) => (s.id === member.id ? { ...s, active: member.active } : s)),
      );
    } finally {
      setLoadingId(null);
    }
  }

  // ── PIN edit ──────────────────────────────────────────────────────────────

  function startPinEdit(member: AdminStaffManagementRow) {
    setPinEditId(member.id);
    setPinValue(member.pin ?? '');
    setPinError(null);
    // Focus en el siguiente tick
    setTimeout(() => pinInputRef.current?.focus(), 50);
  }

  function cancelPinEdit() {
    setPinEditId(null);
    setPinValue('');
    setPinError(null);
  }

  async function savePin(member: AdminStaffManagementRow) {
    const trimmed = pinValue.trim();

    if (trimmed !== '' && !/^\d{4}$/.test(trimmed)) {
      setPinError('El PIN debe ser exactamente 4 digitos');
      return;
    }

    setLoadingId(member.id);
    setPinError(null);

    const newPin = trimmed === '' ? null : trimmed;

    try {
      const res = await fetch(`/api/staff/${member.id}/manage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pin: newPin }),
      });

      if (res.ok) {
        setStaff((prev) =>
          prev.map((s) => (s.id === member.id ? { ...s, pin: newPin } : s)),
        );
        setPinEditId(null);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPinError(body.error ?? 'Error al guardar PIN');
      }
    } catch {
      setPinError('Error de red al guardar PIN');
    } finally {
      setLoadingId(null);
    }
  }

  // ── Abrir editor de horario ────────────────────────────────────────────────

  const openScheduleEditor = useCallback(async (member: AdminStaffManagementRow) => {
    setScheduleLoadingId(member.id);
    setScheduleError(null);

    try {
      const res = await fetch(`/api/staff/${member.id}/schedule`, {
        credentials: 'same-origin',
      });

      if (!res.ok) {
        setScheduleError({ id: member.id, msg: 'Error al cargar horario' });
        return;
      }

      const availability = await res.json() as StaffAvailabilitySlot[];
      setModal({ type: 'schedule', staffId: member.id, staffName: member.name, availability });
    } catch {
      setScheduleError({ id: member.id, msg: 'Error de red al cargar horario' });
    } finally {
      setScheduleLoadingId(null);
    }
  }, []);

  // ── Cerrar modal ──────────────────────────────────────────────────────────

  function closeModal() {
    setModal(null);
    setScheduleError(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-2">
        {staff.map((member) => {
          const isLoading    = loadingId === member.id;
          const isEditingPin = pinEditId === member.id;
          const showPin      = member.role === 'barber';
          const isLoadingSched = scheduleLoadingId === member.id;
          const schedErr = scheduleError?.id === member.id ? scheduleError.msg : null;

          return (
            <div
              key={member.id}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                member.active ? 'border-gray-100 bg-white' : 'border-gray-100 bg-gray-50'
              }`}
            >
              {/* Avatar */}
              <div className="shrink-0">
                {member.photo_url ? (
                  <img
                    src={member.photo_url}
                    alt={member.name}
                    className={`h-9 w-9 rounded-full object-cover ${!member.active ? 'opacity-40' : ''}`}
                  />
                ) : (
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
                      member.active ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {initials(member.name)}
                  </div>
                )}
              </div>

              {/* Info + controles */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={`truncate text-sm font-medium ${member.active ? 'text-gray-900' : 'text-gray-400'}`}>
                    {member.name}
                  </p>
                  <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                    {ROLE_LABELS[member.role] ?? member.role}
                  </span>
                </div>

                {/* PIN (solo barberos) */}
                {showPin && (
                  <div className="mt-1">
                    {isEditingPin ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          ref={pinInputRef}
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          value={pinValue}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                            setPinValue(v);
                            setPinError(null);
                          }}
                          placeholder="1234"
                          className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-center font-mono text-sm focus:border-gray-500 focus:outline-none"
                        />
                        <button
                          onClick={() => void savePin(member)}
                          disabled={isLoading}
                          className="rounded bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                        >
                          {isLoading ? '...' : 'Guardar'}
                        </button>
                        <button
                          onClick={cancelPinEdit}
                          disabled={isLoading}
                          className="text-[11px] text-gray-400 hover:text-gray-600"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startPinEdit(member)}
                        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700"
                      >
                        <span className="font-mono">
                          PIN: {member.pin ? '••••' : '—'}
                        </span>
                        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                          <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81 3.25 11.31a.25.25 0 00-.064.108l-.65 2.278 2.278-.65a.25.25 0 00.108-.064L11.19 6.25z" />
                        </svg>
                      </button>
                    )}
                    {pinError && (
                      <p className="mt-0.5 text-[10px] text-red-500">{pinError}</p>
                    )}
                  </div>
                )}

                {/* Botones Horario + Dia libre */}
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => void openScheduleEditor(member)}
                    disabled={isLoadingSched || !!modal}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                  >
                    {isLoadingSched ? (
                      <span className="text-[11px] text-gray-400">Cargando...</span>
                    ) : (
                      <>
                        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                          <path d="M4.75 0a.75.75 0 01.75.75V2h5V.75a.75.75 0 011.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0113.25 16H2.75A1.75 1.75 0 011 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 014.75 0zm0 3.5h-2a.25.25 0 00-.25.25V6h10.5V3.75a.25.25 0 00-.25-.25h-2V4.25a.75.75 0 01-1.5 0V3.5h-5v.75a.75.75 0 01-1.5 0V3.5zM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25V7.5H2.5z" />
                        </svg>
                        Horario
                      </>
                    )}
                  </button>
                  <span className="text-gray-200" aria-hidden>|</span>
                  <button
                    onClick={() => setModal({ type: 'dayoff', staffId: member.id, staffName: member.name })}
                    disabled={!!modal}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                      <path fillRule="evenodd" d="M4.75 0a.75.75 0 01.75.75V2h5V.75a.75.75 0 011.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0113.25 16H2.75A1.75 1.75 0 011 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 014.75 0zm0 3.5h-2a.25.25 0 00-.25.25V6h10.5V3.75a.25.25 0 00-.25-.25h-2V4.25a.75.75 0 01-1.5 0V3.5h-5v.75a.75.75 0 01-1.5 0V3.5zM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25V7.5H2.5zm5.75 2.25a.75.75 0 00-1.5 0v1.5h-1.5a.75.75 0 000 1.5h1.5v1.5a.75.75 0 001.5 0v-1.5h1.5a.75.75 0 000-1.5h-1.5v-1.5z" />
                    </svg>
                    Dia libre
                  </button>
                </div>
                {schedErr && (
                  <p className="mt-0.5 text-[10px] text-red-500">{schedErr}</p>
                )}
              </div>

              {/* Toggle active */}
              <button
                onClick={() => void toggleActive(member)}
                disabled={isLoading}
                title={member.active ? 'Desactivar' : 'Activar'}
                aria-label={`${member.active ? 'Desactivar' : 'Activar'} a ${member.name}`}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50 ${
                  member.active ? 'bg-gray-800' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    member.active ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Modal overlay ─────────────────────────────────────────────────────── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="w-full max-w-md overflow-y-auto rounded-t-2xl bg-white px-5 pb-8 pt-5 shadow-xl sm:rounded-2xl" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                {modal.type === 'schedule' ? 'Editar horario' : 'Marcar dia libre'}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                  <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                </svg>
              </button>
            </div>

            {/* Contenido */}
            {modal.type === 'schedule' && (
              <StaffScheduleEditor
                staffId={modal.staffId}
                staffName={modal.staffName}
                availability={modal.availability}
                onSaved={closeModal}
                onCancel={closeModal}
              />
            )}
            {modal.type === 'dayoff' && (
              <QuickDayOff
                staffId={modal.staffId}
                staffName={modal.staffName}
                onSaved={closeModal}
                onCancel={closeModal}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
