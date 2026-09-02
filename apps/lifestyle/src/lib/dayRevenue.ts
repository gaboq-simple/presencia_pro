// ─── Ingresos DERIVADOS del día — la matemática, sin BD ───────────────────────
// Sin DB, sin red, sin React. Vive aparte de `dashboard.types.ts` por la misma
// razón que `corte.ts` vive aparte de `corteData.ts`: la matemática no toca la
// BD y la BD no hace matemática. Acá el motivo es además práctico —
// `dashboard.types.ts` importa el cliente de Supabase y el alias `@/`, así que
// una suite pura no puede cargarlo (lo dice `appointmentSelect.test.ts`, que por
// eso lo lee como texto). Estando acá, esta función SÍ se puede probar.
//
// 🔴 FRONTERA DERIVADO/CONFIRMADO (D6). Esto es el DERIVADO: agenda × precio.
//    "Cobrado" es otra cosa —eventos firmados, atribuidos por `completed_at`— y
//    vive en `lib/cobrado.ts`. Ver el bloque rojo de `DiaRail.tsx`.

import type { DashboardAppointment, DayRevenue } from './dashboard.types';

/**
 * Ingresos derivados de las citas completadas del día.
 *
 * **El embed de servicio puede faltar.** `appointments.service_id` es NULL-able
 * en la BD (verificado contra `information_schema`), así que el join puede venir
 * vacío — y el tipo `DashboardAppointment.service` lo declara no-nullable sobre
 * una hidratación por cast, o sea que TypeScript no avisa. Sin guard, una sola
 * fila así lanzaba `TypeError` acá; y como esta función la llama un Server
 * Component (`app/dashboard/page.tsx`), eso no era un número mal: era un 500 y
 * la pestaña Administrar del dueño sin cargar.
 *
 * Qué vale una cita sin servicio: **su precio sellado.** `price_charged` es el
 * hecho —una persona lo cobró— y el embed es metadata del catálogo; perder el
 * catálogo no borra el cobro. Sólo cuando faltan los dos aporta 0, que es lo
 * único honesto cuando no hay ningún precio del que hablar.
 */
export function computeDayRevenue(appointments: DashboardAppointment[]): DayRevenue {
  const completed = appointments.filter((a) => a.status === 'completed');
  // Precio SELLADO al completar (049) — editar el precio del servicio NO reescribe la
  // historia. Fallback al precio vivo solo para completadas legacy sin sello.
  const total = completed.reduce((sum, a) => sum + (a.price_charged ?? a.service?.price ?? 0), 0);
  // El `?.` de `completed[0]` cubría la lista vacía, no el embed ausente: con una
  // primera cita sin servicio, esta línea reventaba igual que la de arriba.
  const currency = completed[0]?.service?.currency ?? 'MXN';
  return { total, currency, completedCount: completed.length };
}
