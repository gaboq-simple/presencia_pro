// ─── diaRailData — el insumo del riel del día (dv3-4') ───────────────────────
// Server-only. No consulta nada: la página ya trae las citas y el staff. Lo que
// hace es lo único impuro del riel — **leer el reloj** — y traducir los DTOs del
// dashboard a la forma que entiende `computeDiaRail`.
//
// Vive acá y no dentro del componente porque un `Date.now()` en render es una
// función impura durante el render (y el compilador de React lo rechaza, con
// razón: dos renders del mismo árbol darían dos rieles distintos). Es la misma
// separación que ya tienen `pulso.ts`/`pulsoData.ts` y `corte.ts`/`corteData.ts`:
// el cálculo es puro y testeable, el reloj entra por la capa de datos.

import type { DashboardAppointment, DashboardStaff } from '@/lib/dashboard.types';
import { isTodayInTz } from '@/lib/dayWindow';
import { staffColorIndex } from '@/lib/staffColors';
import { computeDiaRail, type DiaRail, type RailAppt, type RailTurno } from '@/lib/diaRail';

export async function getDiaRail(
  appointments: readonly DashboardAppointment[],
  staffList: readonly DashboardStaff[],
  date: string,
  timezone: string,
): Promise<DiaRail> {
  const citas: RailAppt[] = appointments.map((a) => ({
    id:          a.id,
    startsAt:    a.starts_at,
    endsAt:      a.ends_at,
    status:      a.status,
    staffId:     a.staff.id,
    staffName:   a.staff.name,
    serviceName: a.service?.name ?? null,
    clientName:  a.customer?.name ?? null,
  }));

  // Solo quien tiene horario ese día puede estar "libre" en un hueco: sin este
  // filtro, un barbero que descansa aparecería ofrecido para las 6 de la tarde.
  const turnos: RailTurno[] = staffList
    .filter((s) => s.availabilityToday !== null)
    .map((s) => ({
      staffId:    s.id,
      staffName:  s.name,
      startTime:  s.availabilityToday!.start_time,
      endTime:    s.availabilityToday!.end_time,
      breakStart: s.availabilityToday!.break_start ?? null,
      breakEnd:   s.availabilityToday!.break_end ?? null,
    }));

  return computeDiaRail({
    citas,
    turnos,
    // El color sale de TODO el staff activo, no solo del que trabaja hoy: si el
    // índice dependiera del día que se mira, el color de un barbero cambiaría al
    // navegar de ayer a hoy y dejaría de ser su identidad.
    colorPorStaff: staffColorIndex(staffList),
    timezone,
    nowMs:         Date.now(),
    esHoy:         isTodayInTz(date, timezone),
  });
}
