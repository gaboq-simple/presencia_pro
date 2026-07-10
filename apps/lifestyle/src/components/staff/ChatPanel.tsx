// ─── ChatPanel ─────────────────────────────────────────────────────────────────
// Panel de chat para una conversación individual.
//
// Responsabilidades:
//   - Header: teléfono + badge session_mode + botón Tomar control / Devolver al bot.
//   - Área de mensajes: burbujas (cliente=izquierda, bot/staff=derecha), scroll al fondo.
//   - Polling cada 5s para nuevos mensajes mientras está abierto.
//   - Input de texto (solo habilitado cuando session_mode='human').
//   - Enter sin Shift = enviar; Shift+Enter = nueva línea.
//   - Mutaciones vía server actions existentes: takeoverConversation,
//     releaseConversation, sendMessageFromPanel.
//   - Se monta encima de ConversationList (mismo z-index — reemplaza el sheet).

'use client';

import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import type { ConversationMessage } from '@/app/staff/assistant-actions';
import {
  getConversationMessages,
  takeoverConversation,
  releaseConversation,
  sendMessageFromPanel,
} from '@/app/staff/assistant-actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  customerPhone:       string;
  initialSessionMode:  'bot' | 'human' | 'paused';
  onBack:              () => void;   // volver a ConversationList
  onClose:             () => void;   // cerrar todo el panel
  onModeChange:        () => void;   // avisar a ConversationList que refresque
};

// ─── Config visual ────────────────────────────────────────────────────────────

const MODE_BADGE: Record<string, string> = {
  human:  'bg-tint-1 text-teal-ink',
  paused: 'bg-amber-tint text-amber',
  bot:    'bg-past-bg text-past-ink',
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

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('es-MX', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatPanel({
  customerPhone,
  initialSessionMode,
  onBack,
  onClose,
  onModeChange,
}: Props) {
  const [messages, setMessages]         = useState<ConversationMessage[]>([]);
  const [sessionMode, setSessionMode]   = useState(initialSessionMode);
  const [messageText, setMessageText]   = useState('');
  const [loadingMsgs, setLoadingMsgs]   = useState(true);
  const [sendError, setSendError]       = useState<string | null>(null);
  const [actionError, setActionError]   = useState<string | null>(null);
  const [isPending, startTransition]    = useTransition();
  const scrollRef                       = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const data = await getConversationMessages(customerPhone);
      setMessages(data);
    } catch {
      // silencio
    } finally {
      setLoadingMsgs(false);
    }
  }, [customerPhone]);

  // Mount + polling cada 5s
  useEffect(() => {
    void loadMessages();
    const interval = setInterval(() => void loadMessages(), 5_000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  // Auto-scroll al fondo cuando llegan mensajes nuevos
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Acciones de control ────────────────────────────────────────────────────

  function handleTakeover() {
    setActionError(null);
    startTransition(async () => {
      try {
        await takeoverConversation(customerPhone);
        setSessionMode('human');
        onModeChange();
      } catch (err) {
        // Error SUAVE en el panel — nunca dejar que suba al error boundary del
        // dashboard (tumbaría toda la vista).
        setActionError(err instanceof Error ? err.message : 'No se pudo tomar control');
      }
    });
  }

  function handleRelease() {
    setActionError(null);
    startTransition(async () => {
      try {
        await releaseConversation(customerPhone);
        setSessionMode('bot');
        onModeChange();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'No se pudo devolver al bot');
      }
    });
  }

  // ── Envío de mensaje ───────────────────────────────────────────────────────

  async function handleSend() {
    const text = messageText.trim();
    if (!text || sessionMode !== 'human') return;
    setSendError(null);
    setMessageText('');
    try {
      await sendMessageFromPanel(customerPhone, text);
      await loadMessages();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Error al enviar');
      setMessageText(text); // restaurar para reintento
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-20 bg-ink/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet — altura fija para dejar espacio al teclado en móvil */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 mx-auto flex max-w-xl flex-col rounded-t-card border border-line bg-card shadow-hero"
        style={{ height: '85vh' }}
      >
        {/* Handle */}
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-pill bg-line-2" />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-line px-3 py-3">
          <div className="flex items-center gap-2">
            {/* Botón volver */}
            <button
              onClick={onBack}
              className="shrink-0 rounded p-1 text-faint hover:text-ink-2"
              aria-label="Volver"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path
                  fillRule="evenodd"
                  d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Teléfono + badge */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold tabular-nums text-ink">
                  {formatPhone(customerPhone)}
                </p>
                <span
                  className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                    MODE_BADGE[sessionMode] ?? 'bg-past-bg text-past-ink'
                  }`}
                >
                  {MODE_LABEL[sessionMode] ?? sessionMode}
                </span>
              </div>
            </div>

            {/* Botón de acción según modo */}
            {sessionMode === 'bot' || sessionMode === 'paused' ? (
              <button
                onClick={handleTakeover}
                disabled={isPending}
                className="shrink-0 rounded-pill bg-teal px-3 py-1.5 text-xs font-semibold text-card shadow-card transition hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? '…' : 'Tomar control'}
              </button>
            ) : (
              <button
                onClick={handleRelease}
                disabled={isPending}
                className="shrink-0 rounded-pill border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-canvas disabled:opacity-50"
              >
                {isPending ? '…' : 'Devolver al bot'}
              </button>
            )}

            {/* Cerrar todo */}
            <button
              onClick={onClose}
              className="shrink-0 rounded p-1 text-faint hover:text-ink-2"
              aria-label="Cerrar"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Aviso suave de error de acción (tomar control / devolver) — NO sube al
            error boundary del dashboard */}
        {actionError && (
          <div className="shrink-0 border-b border-red-border bg-red-tint px-4 py-2 text-center text-xs text-red-ink">
            {actionError}
          </div>
        )}

        {/* ── Área de mensajes ────────────────────────────────────────────── */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
        >
          {loadingMsgs ? (
            <p className="py-8 text-center text-sm text-faint">Cargando mensajes…</p>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-faint">
              Sin mensajes registrados para esta conversación.
            </p>
          ) : (
            messages.map((msg) => {
              const isCustomer = msg.sentBy === 'customer';
              return (
                <div
                  key={msg.id}
                  className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-card px-3 py-2 ${
                      isCustomer
                        ? 'rounded-tl-sm border border-line bg-canvas text-ink'
                        : msg.sentBy === 'bot'
                        ? 'rounded-tr-sm bg-ink text-card'
                        : 'rounded-tr-sm bg-teal-ink text-card'
                    }`}
                  >
                    {/* Label del remitente (solo mensajes salientes) */}
                    {!isCustomer && (
                      <p className="mb-0.5 text-[10px] font-medium opacity-70">
                        {msg.sentBy === 'bot' ? 'Bot' : 'Staff'}
                      </p>
                    )}
                    <p className="text-sm leading-snug">{msg.body}</p>
                    <p
                      className={`mt-0.5 text-[10px] ${
                        isCustomer ? 'text-faint' : 'opacity-60'
                      }`}
                    >
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Input de mensaje ────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-line px-4 pb-6 pt-3">
          {sessionMode !== 'human' && (
            <p className="mb-2 text-center text-xs text-faint">
              Toma control para enviar mensajes
            </p>
          )}
          {sendError && (
            <p className="mb-1 text-xs text-red-ink">{sendError}</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              disabled={sessionMode !== 'human'}
              rows={2}
              maxLength={1000}
              placeholder={sessionMode === 'human' ? 'Escribe un mensaje…' : '—'}
              className="flex-1 resize-none rounded-card border border-line px-3 py-2 text-sm outline-none focus:border-teal-border disabled:bg-canvas disabled:text-faint disabled:placeholder-faint"
            />
            <button
              onClick={() => void handleSend()}
              disabled={sessionMode !== 'human' || !messageText.trim()}
              className="shrink-0 rounded-pill bg-teal px-4 py-2.5 text-sm font-semibold text-card shadow-card transition hover:opacity-90 disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
