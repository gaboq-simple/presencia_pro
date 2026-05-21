// ─── DashboardRealtimeProvider ────────────────────────────────────────────────
// Client Component — gestiona el estado en tiempo real de las citas del día.
//
// Responsabilidades:
//   - Recibe citas iniciales del Server Component (SSR inmediato).
//   - Suscribe a postgres_changes en `appointments` filtrado por business_id.
//   - En INSERT: fetch con joins de la nueva cita y agrega al estado.
//   - En UPDATE: fetch con joins y reemplaza en el estado.
//   - En DELETE: elimina del estado por id.
//   - Limpia el canal en unmount (supabase.removeChannel).
//   - Resetea el estado cuando cambia la fecha (nueva navegación de día).
//   - Renderiza DayTimeline + StaffAvailability compartiendo el mismo estado.

'use client';

import { useState, useEffect, useRef } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { DashboardAppointment, DashboardStaff } from '@/lib/dashboard.types';
import DayTimeline from './DayTimeline';
import StaffAvailability from './StaffAvailability';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  businessId: string;
  date: string;
  initialAppointments: DashboardAppointment[];
  staffList: DashboardStaff[];
};

// ─── Shape mínimo de fila de appointments en Realtime ────────────────────────
// Realtime entrega el row plano (sin joins). Solo usamos id y starts_at.

type AppointmentRowMin = {
  id: string;
  starts_at: string;
};

// ─── Helper: refetch de una cita con todos los joins ─────────────────────────
// Usa el browser client (anon key + sesión). RLS garantiza aislamiento.

async function fetchAppointmentById(
  id: string,
): Promise<DashboardAppointment | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      starts_at,
      ends_at,
      status,
      source,
      notes,
      staff:staff_id(id, name),
      service:service_id(id, name, duration_minutes, price, currency),
      customer:customer_id(id, name, phone)
    `)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as DashboardAppointment;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardRealtimeProvider({
  businessId,
  date,
  initialAppointments,
  staffList,
}: Props) {
  const [appointments, setAppointments] = useState<DashboardAppointment[]>(initialAppointments);
  const [prevDate, setPrevDate] = useState(date);
  if (prevDate !== date) {
    setPrevDate(date);
    setAppointments(initialAppointments);
  }

  // Ref para acceder a la fecha actual dentro del callback de Realtime
  // sin que el effect se re-ejecute al cambiar de día.
  const dateRef = useRef(date);
  useEffect(() => { dateRef.current = date; });

  // ── Suscripción Realtime ─────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`admin-appointments-${businessId}`)
      .on<AppointmentRowMin>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `business_id=eq.${businessId}`,
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

          // Ignorar citas de otros días — solo actualizar la vista activa
          const apptDate = newRow.starts_at.slice(0, 10);
          if (apptDate !== currentDate) return;

          const updated = await fetchAppointmentById(newRow.id);
          if (!updated) return;

          if (payload.eventType === 'INSERT') {
            setAppointments((prev) => {
              const withNew = [...prev, updated];
              return withNew.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
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

    // Cleanup: libera el canal al desmontar
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId]); // Solo se re-suscribe si cambia el negocio (multi-tenant)

  return (
    // Mobile: columna única (375px). sm+: grid — timeline a la izquierda,
    // chips de barberos en columna lateral (200px).
    <div className="grid gap-3 sm:grid-cols-[1fr_200px] sm:items-start">
      <DayTimeline appointments={appointments} date={date} />
      <StaffAvailability staffList={staffList} appointments={appointments} />
    </div>
  );
}
