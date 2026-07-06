// ─── ClientProfileCard ────────────────────────────────────────────────────────
// Client Component — ficha contextual del cliente para el barbero.
//
// Aparece SOLO cuando hay una cita próxima en las siguientes 2 horas con
// un customer_id registrado. Se renderiza encima de NextClientCard.
//
// Carga el perfil via GET /api/customers/{customer_id}/profile.
// Guarda notas via PATCH /api/customers/{customer_id}/notes.
//
// Restricción: nunca muestra datos de clientes de otras citas que no sean
// la próxima del barbero autenticado.

'use client';

import { useState, useEffect, useRef } from 'react';
import type { ClientProfile } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  customerId: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function relativeLastVisit(lastVisit: string | null): string {
  if (!lastVisit) return 'Primera visita';
  const diffMs = Date.now() - new Date(lastVisit).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Hace 1 día';
  if (days < 7) return `Hace ${days} días`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return 'Hace 1 semana';
  if (weeks < 5) return `Hace ${weeks} semanas`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'Hace 1 mes';
  return `Hace ${months} meses`;
}

// ─── Subcomponente: badge cliente nuevo ───────────────────────────────────────

function NewClientBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
      Cliente nuevo ✦
    </span>
  );
}

// ─── Subcomponente: campo de notas editable inline ────────────────────────────

function NotesField({
  customerId,
  initialNotes,
}: {
  customerId: string;
  initialNotes: string | null;
}) {
  const [value, setValue] = useState(initialNotes ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function saveNotes(notes: string) {
    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/customers/${customerId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ notes }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      setSaved(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  // Debounce: guarda 1.2s después del último keystroke
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    setSaved(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void saveNotes(next);
    }, 1200);
  }

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-ink-2">Notas del staff</p>
      <textarea
        value={value}
        onChange={handleChange}
        maxLength={500}
        rows={3}
        placeholder="Agrega una nota sobre este cliente..."
        className="mt-1 w-full resize-none rounded-lg border border-line bg-tint-1 px-3 py-2 text-sm text-ink placeholder-faint focus:border-line-2 focus:bg-card focus:outline-none"
      />
      <div className="mt-0.5 flex items-center justify-between">
        <span className="text-xs text-faint">{value.length}/500</span>
        {saving && <span className="text-xs text-faint">Guardando...</span>}
        {saved && !saving && <span className="text-xs text-teal-ink">Guardado</span>}
        {saveError && <span className="text-xs text-red-ink">{saveError}</span>}
      </div>
    </div>
  );
}

// ─── Component principal ──────────────────────────────────────────────────────

export default function ClientProfileCard({ customerId }: Props) {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/customers/${customerId}/profile`, {
          credentials: 'same-origin',
        });

        if (!res.ok) {
          // 404 puede ocurrir si la cita ya no está vigente — silencio
          if (res.status === 404) return;
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as ClientProfile;
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar perfil');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [customerId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-line bg-tint-1 px-4 py-3">
        <p className="text-xs text-faint">Cargando perfil...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-border bg-red-tint px-4 py-3">
        <p className="text-xs text-red-ink">{error}</p>
      </div>
    );
  }

  if (!profile) return null;

  const isNewClient = profile.visit_count <= 1;

  return (
    <div className="rounded-xl border-2 border-line bg-tint-1 px-4 py-4">
      {/* Nombre + visita # + badge nuevo */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold text-ink">{profile.name}</p>
          <p className="mt-0.5 text-xs text-ink-2">
            Visita #{profile.visit_count > 0 ? profile.visit_count : 1}
          </p>
        </div>
        {isNewClient && <NewClientBadge />}
      </div>

      {/* Servicio de hoy + hora */}
      <div className="mt-3 rounded-lg border border-line bg-card px-3 py-2">
        <p className="text-xs text-faint">Hoy</p>
        <p className="text-sm font-semibold text-ink">
          {profile.upcoming_appointment.service_name}
        </p>
        <p className="text-xs text-ink-2">
          {formatTime(profile.upcoming_appointment.starts_at)}
          {' – '}
          {formatTime(profile.upcoming_appointment.ends_at)}
        </p>
      </div>

      {/* Datos contextuales */}
      <div className="mt-3 space-y-1.5">
        {/* Última visita */}
        <p className="text-xs text-ink-2">
          <span className="font-medium text-ink">Última visita:</span>{' '}
          {relativeLastVisit(profile.last_visit)}
        </p>

        {/* Servicio frecuente */}
        {profile.favorite_service && (
          <p className="text-xs text-ink-2">
            <span className="font-medium text-ink">Usualmente pide:</span>{' '}
            {profile.favorite_service}
          </p>
        )}

        {/* Barbero favorito — solo si es diferente al staff autenticado */}
        {profile.favorite_staff && (
          <p className="text-xs text-ink-2">
            Suele venir con{' '}
            <span className="font-medium text-ink">{profile.favorite_staff}</span>
          </p>
        )}
      </div>

      {/* Notas editable */}
      <NotesField customerId={profile.customer_id} initialNotes={profile.notes} />
    </div>
  );
}
