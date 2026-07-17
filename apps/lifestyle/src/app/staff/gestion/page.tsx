// ─── Staff / Gestión — REDIRECT ───────────────────────────────────────────────
// La vista de gestión del barbero se fusionó con /staff (shell unificado con tab
// bar: Hoy / Semana / Cierre). Esta ruta se conserva SOLO como redirect para que
// bookmarks y links viejos a /staff/gestion no den 404 — preserva ?date=.
//
// No borrar: cualquier enlace externo a /staff/gestion debe seguir aterrizando.

import { redirect } from 'next/navigation';

function isValidDate(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T12:00:00`));
}

export default async function StaffGestionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: rawDate } = await searchParams;
  const date = isValidDate(rawDate) ? rawDate : undefined;
  redirect(date ? `/staff?date=${date}` : '/staff');
}
