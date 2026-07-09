// ─── ConversationList ──────────────────────────────────────────────────────────
// Sheet de conversaciones activas del negocio.
//
// Responsabilidades:
//   - Carga y lista bot_conversations via getActiveConversations() (server action).
//   - Polling cada 10s para detectar cambios de sesión nuevos.
//   - Orden: human primero (en amarillo), paused (gris), bot (verde).
//   - Click en fila → abre ChatPanel como overlay encima de este sheet.
//   - Patrón de modal: mismo que NewAppointmentForm (fixed bottom sheet).

'use client';

import { useState, useEffect, useCallback } from 'react';
import { getActiveConversations } from '@/app/staff/assistant-actions';
import type { ConversationSummary } from '@/app/staff/assistant-actions';
import ChatPanel from './ChatPanel';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  onClose: () => void;
};

// ─── Config visual ────────────────────────────────────────────────────────────

const MODE_BADGE: Record<string, string> = {
  human:  'bg-yellow-100 text-yellow-800',
  paused: 'bg-gray-100 text-gray-600',
  bot:    'bg-green-100 text-green-800',
};

const MODE_LABEL: Record<string, string> = {
  human:  'Humano',
  paused: 'Pausado',
  bot:    'Bot',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    return `${last10.slice(0, 3)} ${last10.slice(3, 6)} ${last10.slice(6)}`;
  }
  return phone;
}

function timeAgo(isoStr: string): string {
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60_000);
  if (mins < 1)   return 'Ahora';
  if (mins < 60)  return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConversationList({ onClose }: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getActiveConversations();
      setConversations(data);
    } catch {
      // silencio — no romper UI por error de red
    } finally {
      setLoading(false);
    }
  }, []);

  // Mount + polling cada 10s
  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, [load]);

  // ── ChatPanel abierto — overlay encima de este sheet ──────────────────────
  if (selectedPhone !== null) {
    const conv = conversations.find((c) => c.customerPhone === selectedPhone);
    return (
      <ChatPanel
        customerPhone={selectedPhone}
        initialSessionMode={conv?.sessionMode ?? 'bot'}
        onBack={() => setSelectedPhone(null)}
        onClose={onClose}
        onModeChange={() => void load()}
      />
    );
  }

  const humanCount = conversations.filter((c) => c.sessionMode === 'human').length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-20 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-xl rounded-t-2xl bg-white shadow-2xl"
        style={{ maxHeight: '80vh' }}
      >
        {/* Handle */}
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-gray-200" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Conversaciones</h2>
            {!loading && (
              <p className="text-xs text-gray-400">
                {humanCount > 0
                  ? `${humanCount} bajo control humano · ${conversations.length} total`
                  : `${conversations.length} conversacion${conversations.length !== 1 ? 'es' : ''}`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Lista */}
        <div
          className="overflow-y-auto pb-8"
          style={{ maxHeight: 'calc(80vh - 80px)' }}
        >
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">Cargando…</p>
          ) : conversations.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              Sin conversaciones registradas.
            </p>
          ) : (
            <ul>
              {conversations.map((conv) => (
                <li key={conv.customerPhone}>
                  <button
                    onClick={() => setSelectedPhone(conv.customerPhone)}
                    className="flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100"
                  >
                    {/* Avatar — últimos 2 dígitos del teléfono */}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                      {conv.customerPhone.replace(/\D/g, '').slice(-2)}
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Teléfono + badge de modo */}
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium tabular-nums text-gray-900">
                          {formatPhone(conv.customerPhone)}
                        </p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            MODE_BADGE[conv.sessionMode] ?? 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {MODE_LABEL[conv.sessionMode] ?? conv.sessionMode}
                        </span>
                      </div>

                      {/* Estado FSM + quien tiene control. Takeover a nivel negocio
                          (recepción/asistente, sin staff) → "Recepción". */}
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {conv.state}
                        {conv.takenByName
                          ? ` · ${conv.takenByName}`
                          : conv.sessionMode === 'human'
                            ? ' · Recepción'
                            : ''}
                      </p>

                      {/* Tiempo desde último mensaje */}
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {timeAgo(conv.lastMessage)}
                      </p>
                    </div>

                    {/* Chevron */}
                    <svg
                      className="mt-1 h-4 w-4 shrink-0 text-gray-300"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
