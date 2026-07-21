// ─── Panel de administración inline (Negocio · Paso 3) ────────────────────────
// El atajo a lo más tocado, SIN salir del dashboard. Tabs Servicios / Equipo /
// Horarios que cambian el contenido inline. NO reemplaza la pestaña "Gestión" (el
// lugar completo): cada tab enlaza a Gestión para lo que no es "cambio rápido"
// (crear servicio, alta de barbero + PIN, config fina).
//
// 🔴 Reusa el CRUD existente por fetch a los MISMOS endpoints — la doble
//    invalidación de cache (invalidateBusinessCache + revalidateTag) y el
//    management_audit (firmado con el staff_id del dueño) viven EN las rutas, no acá.
//    Este componente es envoltura de UI: cero lógica de negocio duplicada.
// Client Component. Tokens Zentriq-claro, Inter tabular-nums.

'use client';

import { useEffect, useState } from 'react';
import type { AdminServiceRow, AdminStaffManagementRow } from '@/lib/dashboard.types';

type TabKey = 'servicios' | 'equipo' | 'horarios';

const money = (n: number, currency = 'MXN'): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

const PencilIcon = (): React.ReactElement => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086z" />
  </svg>
);

// ── Toggle activo (Zentriq) ───────────────────────────────────────────────────
function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }): React.ReactElement {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${on ? 'bg-teal-border' : 'bg-line-2'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

function GestionLink({ children }: { children: React.ReactNode }): React.ReactElement {
  // Ancla a #gestion → OwnerTabs escucha el hashchange y cambia de pestaña sin navegar.
  return (
    <a href="#gestion" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-teal-ink hover:underline">
      {children} <span aria-hidden="true">→</span>
    </a>
  );
}

// ── Servicios ─────────────────────────────────────────────────────────────────
function ServiciosTab({ initial }: { initial: AdminServiceRow[] }): React.ReactElement {
  const [rows, setRows] = useState<AdminServiceRow[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>, optimistic: (r: AdminServiceRow) => AdminServiceRow): Promise<boolean> {
    setBusyId(id); setErr(null);
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? optimistic(r) : r)));
    try {
      const res = await fetch(`/api/services/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!res.ok) { setRows(prev); setErr('No se pudo guardar. Intentá de nuevo.'); return false; }
      const updated = (await res.json()) as AdminServiceRow;
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      return true;
    } catch { setRows(prev); setErr('No se pudo guardar. Intentá de nuevo.'); return false; }
    finally { setBusyId(null); }
  }

  function startEdit(s: AdminServiceRow) { setEditId(s.id); setDraft(String(s.price)); setErr(null); }
  async function saveEdit(s: AdminServiceRow) {
    const price = Number(draft);
    if (!Number.isFinite(price) || price < 0) { setErr('Precio inválido.'); return; }
    if (price === s.price) { setEditId(null); return; }
    const ok = await patch(s.id, { price }, (r) => ({ ...r, price }));
    if (ok) setEditId(null);
  }

  return (
    <div>
      {err && <p className="mb-2 text-[12px] text-red-ink">{err}</p>}
      <ul className="divide-y divide-line">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`truncate text-sm font-medium ${s.active ? 'text-ink' : 'text-faint'}`}>{s.name}</span>
                {!s.active && <span className="shrink-0 rounded-full bg-past-bg px-1.5 py-0.5 text-[10px] text-faint">Inactivo</span>}
              </div>
              {editId === s.id ? (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number" inputMode="numeric" value={draft} autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(s); if (e.key === 'Escape') setEditId(null); }}
                    className="w-24 rounded-lg border border-line-2 bg-card px-2 py-1 text-sm tabular-nums text-ink focus:border-teal-border focus:outline-none"
                  />
                  <button type="button" onClick={() => void saveEdit(s)} disabled={busyId === s.id}
                    className="rounded-lg bg-teal-border px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Guardar</button>
                  <button type="button" onClick={() => setEditId(null)} className="text-xs text-faint hover:text-ink">Cancelar</button>
                </div>
              ) : (
                <button type="button" onClick={() => startEdit(s)}
                  className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
                  <span className="tabular-nums">{money(s.price, s.currency)}</span>
                  <span className="text-faint">· {s.duration_minutes} min</span>
                  <span className="text-teal-ink"><PencilIcon /></span>
                </button>
              )}
            </div>
            <Toggle on={s.active} disabled={busyId === s.id} label={`${s.active ? 'Desactivar' : 'Activar'} ${s.name}`}
              onClick={() => void patch(s.id, { active: !s.active }, (r) => ({ ...r, active: !r.active }))} />
          </li>
        ))}
      </ul>
      <GestionLink>Agregar servicio nuevo</GestionLink>
    </div>
  );
}

// ── Equipo ────────────────────────────────────────────────────────────────────
function EquipoTab({ initial }: { initial: AdminStaffManagementRow[] }): React.ReactElement {
  const [rows, setRows] = useState<AdminStaffManagementRow[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dayOffId, setDayOffId] = useState<string | null>(null);
  const [dayOffDate, setDayOffDate] = useState<string>('');
  const [warn, setWarn] = useState<{ staffId: string; message: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(s: AdminStaffManagementRow) {
    setBusyId(s.id); setErr(null);
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === s.id ? { ...r, active: !r.active } : r)));
    try {
      const res = await fetch(`/api/staff/${s.id}/manage`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ active: !s.active }),
      });
      if (!res.ok) { setRows(prev); setErr('No se pudo guardar.'); }
    } catch { setRows(prev); setErr('No se pudo guardar.'); }
    finally { setBusyId(null); }
  }

  async function submitDayOff(s: AdminStaffManagementRow, force: boolean) {
    if (!dayOffDate) { setErr('Elegí una fecha.'); return; }
    setBusyId(s.id); setErr(null); setMsg(null); setWarn(null);
    try {
      const res = await fetch(`/api/staff/${s.id}/day-off`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ date: dayOffDate, force }),
      });
      const data = (await res.json()) as { warning?: boolean; message?: string; error?: string };
      if (!res.ok) { setErr(data.error ?? 'No se pudo dar el día libre.'); return; }
      // Hay citas ese día → el endpoint pide confirmación; ofrecemos "Confirmar igual" (force).
      if (data.warning) { setWarn({ staffId: s.id, message: data.message ?? 'Tiene citas ese día.' }); return; }
      setMsg(`Día libre de ${s.name} el ${dayOffDate} aplicado.`);
      setDayOffId(null); setDayOffDate('');
    } catch { setErr('No se pudo dar el día libre.'); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      {err && <p className="mb-2 text-[12px] text-red-ink">{err}</p>}
      {warn && (
        <p className="mb-2 text-[12px] text-amber">
          {warn.message}{' '}
          <button type="button" onClick={() => { const s = rows.find((r) => r.id === warn.staffId); if (s) void submitDayOff(s, true); }}
            className="ml-1 font-medium text-teal-ink underline">Confirmar igual</button>
        </p>
      )}
      {msg && <p className="mb-2 text-[12px] text-teal-ink">{msg}</p>}
      <ul className="divide-y divide-line">
        {rows.map((s) => (
          <li key={s.id} className="py-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`truncate text-sm font-medium ${s.active ? 'text-ink' : 'text-faint'}`}>{s.name}</span>
                  {!s.active && <span className="shrink-0 rounded-full bg-past-bg px-1.5 py-0.5 text-[10px] text-faint">Inactivo</span>}
                </div>
                {s.role === 'barber' && s.active && (
                  <button type="button" onClick={() => { setDayOffId(dayOffId === s.id ? null : s.id); setDayOffDate(''); setErr(null); setMsg(null); }}
                    className="mt-0.5 text-xs text-ink-2 hover:text-ink">Dar día libre</button>
                )}
              </div>
              <Toggle on={s.active} disabled={busyId === s.id} label={`${s.active ? 'Desactivar' : 'Activar'} ${s.name}`}
                onClick={() => void toggle(s)} />
            </div>
            {dayOffId === s.id && (
              <div className="mt-2 flex items-center gap-2">
                <input type="date" value={dayOffDate} onChange={(e) => setDayOffDate(e.target.value)}
                  className="rounded-lg border border-line-2 bg-card px-2 py-1 text-sm tabular-nums text-ink focus:border-teal-border focus:outline-none" />
                <button type="button" onClick={() => void submitDayOff(s, false)} disabled={busyId === s.id}
                  className="rounded-lg bg-teal-border px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Aplicar</button>
                <button type="button" onClick={() => setDayOffId(null)} className="text-xs text-faint hover:text-ink">Cancelar</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <GestionLink>Alta de barbero, PIN y servicios</GestionLink>
    </div>
  );
}

// ── Horarios (del negocio — viste la landing pública) ─────────────────────────
type OfficeHours = Record<string, { start: string; end: string } | null>;
const DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function HorariosTab(): React.ReactElement {
  const [hours, setHours] = useState<OfficeHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Carga al montar la tab (la tab solo se monta cuando el dueño la abre).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/business/hours', { credentials: 'same-origin' });
        const data = (await res.json()) as { office_hours: OfficeHours | null };
        const oh = data.office_hours ?? {};
        const norm: OfficeHours = {};
        for (let d = 0; d < 7; d++) norm[String(d)] = oh[String(d)] ?? null;
        if (alive) setHours(norm);
      } catch { if (alive) setErr('No se pudo cargar el horario.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  function setDay(d: number, val: { start: string; end: string } | null) {
    setHours((h) => (h ? { ...h, [String(d)]: val } : h));
  }

  async function save() {
    if (!hours) return;
    setSaving(true); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/business/hours', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ office_hours: hours }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setErr(data.error ?? 'No se pudo guardar el horario.'); return; }
      setMsg('Horario guardado. La landing pública ya lo refleja.');
    } catch { setErr('No se pudo guardar el horario.'); }
    finally { setSaving(false); }
  }

  if (loading || !hours) return <p className="py-4 text-sm text-faint">Cargando horario…</p>;

  return (
    <div>
      <p className="mb-2 text-xs text-faint">El horario de atención del negocio — lo muestra tu landing pública y lo usa el bot.</p>
      {err && <p className="mb-2 text-[12px] text-red-ink">{err}</p>}
      {msg && <p className="mb-2 text-[12px] text-teal-ink">{msg}</p>}
      <ul className="divide-y divide-line">
        {DOW.map((name, d) => {
          const v = hours[String(d)];
          const open = v !== null;
          return (
            <li key={d} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 text-sm text-ink">{name}</span>
              {open ? (
                <div className="flex flex-1 items-center gap-2">
                  <input type="time" value={v.start} onChange={(e) => setDay(d, { start: e.target.value, end: v.end })}
                    className="rounded-lg border border-line-2 bg-card px-2 py-1 text-sm tabular-nums text-ink focus:border-teal-border focus:outline-none" />
                  <span className="text-faint">–</span>
                  <input type="time" value={v.end} onChange={(e) => setDay(d, { start: v.start, end: e.target.value })}
                    className="rounded-lg border border-line-2 bg-card px-2 py-1 text-sm tabular-nums text-ink focus:border-teal-border focus:outline-none" />
                </div>
              ) : (
                <span className="flex-1 text-sm text-faint">Cerrado</span>
              )}
              <Toggle on={open} label={`${open ? 'Cerrar' : 'Abrir'} ${name}`}
                onClick={() => setDay(d, open ? null : { start: '09:00', end: '18:00' })} />
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="rounded-lg bg-teal-border px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar horario'}
        </button>
        <GestionLink>Horario por barbero</GestionLink>
      </div>
    </div>
  );
}

// ── Shell del panel con tabs ──────────────────────────────────────────────────
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'servicios', label: 'Servicios' },
  { key: 'equipo', label: 'Equipo' },
  { key: 'horarios', label: 'Horarios' },
];

export default function AdminInlinePanel({ services, staff }: { services: AdminServiceRow[]; staff: AdminStaffManagementRow[] }): React.ReactElement {
  const [tab, setTab] = useState<TabKey>('servicios');

  return (
    <section className="mt-6 rounded-xl bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">Administración rápida</p>
      </div>

      {/* Tabs internos (cambian el contenido inline, sin navegar) */}
      <div className="mt-2 inline-flex rounded-lg border border-line bg-canvas p-0.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'true' : undefined}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${tab === t.key ? 'bg-card text-ink shadow-card' : 'text-faint hover:text-ink-2'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === 'servicios' && <ServiciosTab initial={services} />}
        {tab === 'equipo' && <EquipoTab initial={staff} />}
        {tab === 'horarios' && <HorariosTab />}
      </div>

      <p className="mt-3 border-t border-line pt-2 text-[11px] text-faint">
        Cambios rápidos. Para lo completo (crear, dar de alta, config), andá a {String.fromCharCode(0x201C)}Gestión{String.fromCharCode(0x201D)}.
      </p>
    </section>
  );
}
