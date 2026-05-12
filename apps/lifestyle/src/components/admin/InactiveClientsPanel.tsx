'use client';

// ─── InactiveClientsPanel ─────────────────────────────────────────────────────
// Client Component — muestra clientes que llevan más de N días sin visitar.
//
// Tres secciones colapsables por tier:
//   ⚠️ Por vencer (21–30 días)  — fondo amarillo
//   🔴 Inactivos  (31–60 días)  — fondo naranja
//   🚨 En riesgo  (61+ días)    — fondo rojo
//
// Por cada cliente: nombre, días inactivos, último servicio, barbero, visitas,
// y botón "Enviar recordatorio" que abre modal con mensaje pre-redactado editable.
// POST /api/customers/{id}/reactivation al confirmar.

import { useState, useEffect } from 'react';
import type { InactiveClient, InactiveClientTier } from '@/lib/dashboard.types';

// ─── Config de tiers ──────────────────────────────────────────────────────────

type TierConfig = {
  label: string;
  bg: string;
  border: string;
  badge: string;
};

const TIER_CONFIG: Record<InactiveClientTier, TierConfig> = {
  por_vencer: {
    label:  '⚠️ Por vencer',
    bg:     'bg-yellow-50',
    border: 'border-yellow-200',
    badge:  'bg-yellow-100 text-yellow-800',
  },
  inactivo: {
    label:  '🔴 Inactivos',
    bg:     'bg-orange-50',
    border: 'border-orange-200',
    badge:  'bg-orange-100 text-orange-800',
  },
  en_riesgo: {
    label:  '🚨 En riesgo',
    bg:     'bg-red-50',
    border: 'border-red-200',
    badge:  'bg-red-100 text-red-800',
  },
};

const TIER_ORDER: InactiveClientTier[] = ['por_vencer', 'inactivo', 'en_riesgo'];

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  businessName: string;
};

// ─── Modal de reactivación ────────────────────────────────────────────────────

type ModalState = {
  client: InactiveClient;
  message: string;
};

function ReactivationModal({
  modal,
  businessName,
  onClose,
  onSend,
}: {
  modal: ModalState;
  businessName: string;
  onClose: () => void;
  onSend: (clientId: string, message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState(modal.message);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Re-sincronizar si cambia el cliente seleccionado
  useEffect(() => {
    setMessage(modal.message);
    setSent(false);
  }, [modal.message]);

  async function handleConfirm() {
    if (sending || sent) return;
    setSending(true);
    await onSend(modal.client.customer_id, message);
    setSending(false);
    setSent(true);
  }

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white px-5 py-5 shadow-xl">
        <h3 className="text-sm font-semibold text-gray-900">
          Recordatorio para {modal.client.name}
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          El mensaje se enviará por WhatsApp. Puedes editarlo antes de enviar.
        </p>

        <textarea
          className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-gray-500 focus:outline-none"
          rows={4}
          maxLength={300}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={sending || sent}
        />
        <p className="mt-1 text-right text-xs text-gray-400">
          {message.length}/300
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={sending || sent || message.trim().length === 0}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              sent
                ? 'bg-green-600 text-white'
                : 'bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50'
            }`}
          >
            {sent ? '✓ Enviado' : sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tarjeta de cliente ───────────────────────────────────────────────────────

function ClientCard({
  client,
  businessName,
  onReminder,
}: {
  client: InactiveClient;
  businessName: string;
  onReminder: (client: InactiveClient) => void;
}) {
  const tier = TIER_CONFIG[client.tier];

  return (
    <div className={`rounded-lg border ${tier.border} ${tier.bg} px-4 py-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Nombre + días */}
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-gray-900">
              {client.name}
            </p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tier.badge}`}>
              {client.days_inactive}d
            </span>
          </div>

          {/* Último servicio */}
          {(client.last_service || client.last_staff) && (
            <p className="mt-0.5 text-xs text-gray-500">
              {[client.last_service, client.last_staff && `con ${client.last_staff}`]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}

          {/* Visitas totales */}
          <p className="mt-0.5 text-xs text-gray-400">
            {client.visit_count}{' '}
            {client.visit_count === 1 ? 'visita total' : 'visitas totales'}
          </p>
        </div>

        {/* Botón recordatorio */}
        <button
          onClick={() => onReminder(client)}
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Recordatorio
        </button>
      </div>
    </div>
  );
}

// ─── Sección por tier ─────────────────────────────────────────────────────────

function TierSection({
  tier,
  clients,
  businessName,
  onReminder,
}: {
  tier: InactiveClientTier;
  clients: InactiveClient[];
  businessName: string;
  onReminder: (client: InactiveClient) => void;
}) {
  const config = TIER_CONFIG[tier];
  if (clients.length === 0) return null;

  return (
    <details open={tier === 'por_vencer'} className="rounded-lg border border-gray-200">
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 hover:bg-gray-50">
        <span className="text-sm font-medium text-gray-800">
          {config.label}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${config.badge}`}>
          {clients.length}
        </span>
      </summary>
      <div className="space-y-2 border-t border-gray-200 px-4 py-3">
        {clients.map((c) => (
          <ClientCard
            key={c.customer_id}
            client={c}
            businessName={businessName}
            onReminder={onReminder}
          />
        ))}
      </div>
    </details>
  );
}

// ─── Component principal ──────────────────────────────────────────────────────

export default function InactiveClientsPanel({ businessName }: Props) {
  const [clients, setClients] = useState<InactiveClient[] | null>(null);
  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState<string | null>(null);
  const [modal, setModal]      = useState<ModalState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/customers/inactive', { credentials: 'same-origin' });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as InactiveClient[];
        if (!cancelled) setClients(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  function openReminder(client: InactiveClient) {
    const defaultMessage =
      `Hola ${client.name}, hace ${client.days_inactive} días que no te vemos` +
      ` en ${businessName} 💈 ¿Te agendamos esta semana?`;
    setModal({ client, message: defaultMessage });
  }

  async function sendReactivation(clientId: string, message: string) {
    try {
      await fetch(`/api/customers/${clientId}/reactivation`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    } catch {
      // best-effort — fallo silencioso, el modal ya muestra ✓ Enviado
    }
  }

  // Agrupar por tier
  const byTier = new Map<InactiveClientTier, InactiveClient[]>();
  for (const tier of TIER_ORDER) byTier.set(tier, []);
  for (const client of clients ?? []) {
    byTier.get(client.tier)?.push(client);
  }

  return (
    <>
      <div className="rounded-lg border border-gray-200 px-4 py-3">
        <p className="text-xs font-medium text-gray-500">Clientes inactivos</p>

        <div className="mt-3">
          {loading && (
            <p className="text-xs text-gray-400">Cargando...</p>
          )}

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {!loading && !error && clients?.length === 0 && (
            <p className="text-xs text-gray-400">✓ Sin clientes inactivos por ahora</p>
          )}

          {!loading && !error && clients && clients.length > 0 && (
            <div className="space-y-2">
              {TIER_ORDER.map((tier) => (
                <TierSection
                  key={tier}
                  tier={tier}
                  clients={byTier.get(tier) ?? []}
                  businessName={businessName}
                  onReminder={openReminder}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {modal && (
        <ReactivationModal
          modal={modal}
          businessName={businessName}
          onClose={() => setModal(null)}
          onSend={sendReactivation}
        />
      )}
    </>
  );
}
