// ─── Activity Feed — capa visible del audit (server-only) ─────────────────────
// Unifica appointment_audit (citas, migración 045) y management_audit (gestión,
// 053+054) en un feed legible para el dueño. SOLO lectura. Traduce el jsonb crudo
// a lenguaje humano; resuelve ids → nombres; degrada con gracia si algo no resuelve.
//
// Paginación: límite fijo de 50 por página + cursor por created_at ("Cargar más").
// Cada tabla tiene índice (business_id, created_at DESC) → la query es barata.
// Se traen 50 de cada tabla, se mezclan, se ordenan y se corta a 50 (los 50 eventos
// más recientes entre ambas). El cursor es el created_at del último → la siguiente
// página trae lo anterior. (Empate exacto de created_at en el borde: improbable con
// timestamptz de microsegundos; se acepta.)

import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 50;

// ─── Modelo común para la UI ───────────────────────────────────────────────────

export type ActivityCategory = 'citas' | 'gestion';

export type ActivityEvent = {
  id:         string;
  at:         string;                 // ISO created_at
  category:   ActivityCategory;
  actorLabel: string;                 // "Gabriel" | "El bot" | "Sistema" | "Acción sin identificar"
  summary:    string;                 // línea legible (sin jsonb crudo, sin uuid suelto)
  detail:     { before: unknown; after: unknown } | null; // crudo, para el expandible
};

export type ActivityPage = { events: ActivityEvent[]; nextCursor: string | null };

// ─── Service client ─────────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Helpers de resolución / formato ────────────────────────────────────────────

type Maps = {
  staff:    Map<string, string>;  // id → name
  service:  Map<string, string>;  // id → name
  timezone: string;
};

const ROLE_LABEL: Record<string, string> = { barber: 'barbero', assistant: 'asistente', admin: 'encargado' };

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Nombre del actor a partir de actor_staff_id + actor_type. Degrada con gracia. */
function actorLabel(actorStaffId: string | null, actorType: string, maps: Maps): string {
  if (actorStaffId) {
    const name = maps.staff.get(actorStaffId);
    if (name) return name;
    return 'Un miembro del equipo'; // id presente pero no resuelto (raro)
  }
  switch (actorType) {
    case 'bot':    return 'El bot';
    case 'system': return 'Sistema';
    case 'staff':  return 'Alguien del equipo (ya no está)'; // SET NULL: el staff se borró
    default:       return 'Acción sin identificar';           // 'unknown'
  }
}

/** Nombre de servicio: primero el snapshot (sobrevive al borrado), luego el mapa, luego genérico. */
function serviceName(id: string | null | undefined, snapshotName: unknown, maps: Maps): string {
  if (typeof snapshotName === 'string' && snapshotName) return snapshotName;
  if (id) { const n = maps.service.get(id); if (n) return n; }
  return 'un servicio';
}

function staffName(id: string | null | undefined, maps: Maps): string {
  if (id) { const n = maps.staff.get(id); if (n) return n; }
  return 'un miembro del equipo';
}

function serviceIdsToNames(ids: unknown, maps: Maps): string {
  if (!Array.isArray(ids) || ids.length === 0) return 'ninguno';
  return ids.map((id) => maps.service.get(String(id)) ?? '—').join(', ');
}

function money(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? `$${n}` : '—';
}

function formatWhen(iso: unknown, tz: string): string {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: tz, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d).replace(/\./g, '');
  } catch {
    return '';
  }
}

// ─── Traducción: management_audit → summary ─────────────────────────────────────

const SERVICE_FIELD_LABEL: Record<string, string> = {
  price: 'precio', name: 'nombre', duration_minutes: 'duración', description: 'descripción',
  price_min: 'precio mín', price_max: 'precio máx', price_note: 'nota de precio', currency: 'moneda',
};
const CONFIG_FIELD_LABEL: Record<string, string> = {
  report_enabled: 'reportes', report_whatsapp: 'número de reportes',
  review_requests_enabled: 'reseñas automáticas', review_url: 'link de reseñas',
};

function describeManagement(
  row: MgmtRow, actor: string, maps: Maps,
): string {
  const oldD = asObj(row.old_data);
  const newD = asObj(row.new_data);
  const changed = row.changed_fields ?? [];

  switch (row.entity) {
    case 'services': {
      const name = serviceName(row.entity_id, newD['name'] ?? oldD['name'], maps);
      if (row.action === 'created')      return `${actor} creó el servicio ${name}`;
      if (row.action === 'deactivated')  return `${actor} desactivó el servicio ${name}`;
      if (row.action === 'reactivated')  return `${actor} reactivó el servicio ${name}`;
      // updated
      if (changed.length === 1 && changed[0] === 'price')
        return `${actor} cambió el precio de ${name}: ${money(oldD['price'])} → ${money(newD['price'])}`;
      if (changed.length === 1 && changed[0] === 'name')
        return `${actor} renombró el servicio ${oldD['name'] ?? name} → ${newD['name'] ?? name}`;
      const labels = changed.map((f) => SERVICE_FIELD_LABEL[f] ?? f).join(', ');
      return `${actor} editó el servicio ${name}${labels ? ` (${labels})` : ''}`;
    }
    case 'staff': {
      // El snapshot de manage solo trae {active}; el nombre sale del mapa (entity_id).
      const name = (typeof newD['name'] === 'string' && newD['name']) ? newD['name'] as string : staffName(row.entity_id, maps);
      if (row.action === 'created') {
        const role = ROLE_LABEL[String(newD['role'] ?? '')] ?? 'miembro del equipo';
        return `${actor} dio de alta a ${name} (${role})`;
      }
      if (row.action === 'deactivated') return `${actor} desactivó a ${name}`;
      if (row.action === 'reactivated') return `${actor} reactivó a ${name}`;
      // updated — típicamente el PIN (nunca guardamos el valor)
      if (changed.includes('pin')) return `${actor} cambió el PIN de ${name}`;
      return `${actor} editó a ${name}`;
    }
    case 'staff_services': {
      const name = staffName(row.entity_id, maps);
      const before = serviceIdsToNames(oldD['service_ids'], maps);
      const after  = serviceIdsToNames(newD['service_ids'], maps);
      return `${actor} cambió los servicios de ${name}: ${before} → ${after}`;
    }
    case 'businesses': {
      if (changed.includes('office_hours')) return `${actor} cambió los horarios del negocio`;
      // config: describir por campo
      if (changed.length === 1) {
        const f = changed[0]!;
        if (f === 'report_enabled')          return `${actor} ${newD['report_enabled'] ? 'activó' : 'desactivó'} los reportes`;
        if (f === 'review_requests_enabled') return `${actor} ${newD['review_requests_enabled'] ? 'activó' : 'desactivó'} las reseñas automáticas`;
        if (f === 'report_whatsapp')         return `${actor} cambió el número de reportes`;
        if (f === 'review_url')              return `${actor} cambió el link de reseñas`;
      }
      const labels = changed.map((f) => CONFIG_FIELD_LABEL[f] ?? f).join(', ');
      return `${actor} cambió la configuración del negocio${labels ? ` (${labels})` : ''}`;
    }
    default:
      return `${actor} realizó un cambio de gestión`;
  }
}

// ─── Traducción: appointment_audit → summary ────────────────────────────────────

function describeAppointment(row: ApptRow, actor: string, maps: Maps): string {
  const oldD = asObj(row.old_data);
  const newD = asObj(row.new_data);
  const snap = row.action === 'deleted' ? oldD : newD;
  const who = (typeof snap['booking_name'] === 'string' && snap['booking_name']) ? snap['booking_name'] as string : 'un cliente';
  const when = formatWhen(snap['starts_at'], maps.timezone);
  const suffix = when ? ` (${when})` : '';

  switch (row.action) {
    case 'created':
      return `${actor} agendó la cita de ${who}${suffix}`;
    case 'status_changed': {
      const st = String(newD['status'] ?? '');
      if (st === 'cancelled') return `${actor} canceló la cita de ${who}${suffix}`;
      if (st === 'completed') return `${actor} marcó como completada la cita de ${who}${suffix}`;
      if (st === 'no_show')   return `${actor} marcó no-show la cita de ${who}${suffix}`;
      if (st === 'confirmed') return `${actor} confirmó la cita de ${who}${suffix}`;
      return `${actor} cambió el estado de la cita de ${who} a ${st || 'otro'}${suffix}`;
    }
    case 'rescheduled': {
      const from = formatWhen(oldD['starts_at'], maps.timezone);
      const to   = formatWhen(newD['starts_at'], maps.timezone);
      return `${actor} reagendó la cita de ${who}${from && to ? `: ${from} → ${to}` : ''}`;
    }
    case 'deleted':
      return `${actor} eliminó la cita de ${who}${suffix}`;
    default:
      return `${actor} editó la cita de ${who}${suffix}`;
  }
}

// ─── DB row shapes ──────────────────────────────────────────────────────────────

type MgmtRow = {
  id: string; created_at: string; entity: string; entity_id: string; action: string;
  actor_staff_id: string | null; actor_type: string;
  old_data: unknown; new_data: unknown; changed_fields: string[] | null;
};
type ApptRow = {
  id: string; created_at: string; action: string;
  actor_staff_id: string | null; actor_type: string;
  old_data: unknown; new_data: unknown;
};

// ─── Fetch + normalización ──────────────────────────────────────────────────────

export async function getActivityFeed(businessId: string, before?: string): Promise<ActivityPage> {
  const supabase = getServiceClient();

  // Mapas de nombres + timezone (para formatear las citas en hora del negocio).
  const [staffRes, svcRes, bizRes] = await Promise.all([
    supabase.from('staff').select('id, name').eq('business_id', businessId),
    supabase.from('services').select('id, name').eq('business_id', businessId),
    supabase.from('businesses').select('timezone').eq('id', businessId).maybeSingle(),
  ]);

  const maps: Maps = {
    staff:   new Map(((staffRes.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name])),
    service: new Map(((svcRes.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name])),
    timezone: (bizRes.data as { timezone: string } | null)?.timezone ?? 'America/Mexico_City',
  };

  let apptQ = supabase
    .from('appointment_audit')
    .select('id, created_at, action, actor_staff_id, actor_type, old_data, new_data')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  let mgmtQ = supabase
    .from('management_audit')
    .select('id, created_at, entity, entity_id, action, actor_staff_id, actor_type, old_data, new_data, changed_fields')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (before) { apptQ = apptQ.lt('created_at', before); mgmtQ = mgmtQ.lt('created_at', before); }

  const [apptRes, mgmtRes] = await Promise.all([apptQ, mgmtQ]);

  const apptEvents: ActivityEvent[] = ((apptRes.data ?? []) as ApptRow[]).map((r) => {
    const actor = actorLabel(r.actor_staff_id, r.actor_type, maps);
    return {
      id: `a:${r.id}`, at: r.created_at, category: 'citas',
      actorLabel: actor, summary: describeAppointment(r, actor, maps),
      detail: { before: r.old_data, after: r.new_data },
    };
  });

  const mgmtEvents: ActivityEvent[] = ((mgmtRes.data ?? []) as MgmtRow[]).map((r) => {
    const actor = actorLabel(r.actor_staff_id, r.actor_type, maps);
    return {
      id: `m:${r.id}`, at: r.created_at, category: 'gestion',
      actorLabel: actor, summary: describeManagement(r, actor, maps),
      detail: { before: r.old_data, after: r.new_data },
    };
  });

  const events = [...apptEvents, ...mgmtEvents]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, PAGE_SIZE);

  const nextCursor = events.length === PAGE_SIZE ? events[events.length - 1]!.at : null;
  return { events, nextCursor };
}
