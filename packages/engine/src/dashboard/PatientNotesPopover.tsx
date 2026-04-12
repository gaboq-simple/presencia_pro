'use client';

// ─── PatientNotesPopover ───────────────────────────────────────────────────────
// Popover inline de notas operativas del médico sobre un paciente.
// Se abre al hacer click en el ícono StickyNote que aparece en cada cita.
//
// NOTAS OPERATIVAS — no son clínicas ni diagnósticos.
// Son observaciones de gestión: preferencias, recordatorios, logística.
//
// Comportamiento:
//   - Lazy load: fetcha las notas la primera vez que se abre
//   - Solo un popover abierto a la vez — coordinado via CustomEvent en el documento
//   - Añadir nota: optimistic update — aparece al tope sin recargar
//   - Cierre: click fuera, Escape, o al abrir otro popover
//   - Las notas son inmutables — sin editar ni eliminar

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StickyNote, X } from 'lucide-react';
import type { PatientNote } from './types';

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Evento global para coordinar "solo un popover abierto a la vez". */
const NOTES_OPEN_EVENT = 'presenciapro:notes-popover-open';

const MAX_VISIBLE_NOTES = 5;
const MAX_BODY_LENGTH = 500;
const WARN_THRESHOLD = 450;
const DANGER_THRESHOLD = 490;

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PatientNotesPopoverProps = {
  readonly patientId: string;
  readonly patientName: string;
  readonly clientId: string;
  readonly authToken: string;
};

type NotesState = {
  notes: PatientNote[];
  total: number;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formatea una fecha como tiempo relativo en español.
 * Implementado sin dependencias externas.
 */
function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (mins < 60)  return `hace ${mins} min`;
  if (hours < 24) return `hace ${hours}h`;
  if (days < 7)   return `hace ${days} días`;
  if (weeks < 4)  return `hace ${weeks} sem`;
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

function charCountColor(count: number): string {
  if (count >= DANGER_THRESHOLD) return '#A83228';
  if (count >= WARN_THRESHOLD)   return '#B87A1A';
  return '#9B8E80';
}

// ─── PatientNotesPopover ───────────────────────────────────────────────────────

export function PatientNotesPopover({
  patientId,
  patientName,
  clientId,
  authToken,
}: PatientNotesPopoverProps) {
  const [isOpen,    setIsOpen]    = useState(false);
  const [state,     setState]     = useState<NotesState>({ notes: [], total: 0 });
  const [loading,   setLoading]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expanded,  setExpanded]  = useState(false);
  const [body,      setBody]      = useState('');
  const [hasFetched, setHasFetched] = useState(false);

  const wrapperRef  = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Coordinación: un solo popover abierto a la vez ─────────────────────────
  // Cuando este popover se abre, dispara un evento con su patientId.
  // Cuando escucha el evento de otro patientId, se cierra.

  useEffect(() => {
    function handleOtherOpen(e: Event) {
      const evt = e as CustomEvent<{ patientId: string }>;
      if (evt.detail.patientId !== patientId) {
        setIsOpen(false);
      }
    }
    document.addEventListener(NOTES_OPEN_EVENT, handleOtherOpen);
    return () => document.removeEventListener(NOTES_OPEN_EVENT, handleOtherOpen);
  }, [patientId]);

  // ── Fetch lazy: solo la primera vez que se abre ────────────────────────────

  const fetchNotes = useCallback((all = false) => {
    setLoading(true);
    const url = `/api/patients/${patientId}/notes${all ? '?all=true' : ''}`;
    fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ notes: PatientNote[]; total: number }>;
      })
      .then((data) => {
        setState({ notes: data.notes ?? [], total: data.total ?? 0 });
        if (all) setExpanded(true);
      })
      .catch(() => { /* notas no críticas — falla silenciosa */ })
      .finally(() => setLoading(false));
  }, [patientId, authToken]);

  // ── Abrir popover ──────────────────────────────────────────────────────────

  function openPopover() {
    setIsOpen(true);
    document.dispatchEvent(
      new CustomEvent(NOTES_OPEN_EVENT, { detail: { patientId } }),
    );
    if (!hasFetched) {
      setHasFetched(true);
      fetchNotes(false);
    }
  }

  function closePopover() {
    setIsOpen(false);
  }

  function toggle() {
    if (isOpen) {
      closePopover();
    } else {
      openPopover();
    }
  }

  // ── Cerrar al hacer click fuera ────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        closePopover();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // ── Cerrar con Escape ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closePopover();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // ── Agregar nota (optimistic update) ──────────────────────────────────────

  async function handleAddNote() {
    const trimmedBody = body.trim();
    if (!trimmedBody || submitting) return;

    setSubmitting(true);

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticNote: PatientNote = {
      id:        optimisticId,
      patientId,
      body:      trimmedBody,
      createdAt: new Date().toISOString(),
    };

    // Optimistic: agregar al tope inmediatamente
    setState((prev) => ({
      notes: [optimisticNote, ...prev.notes],
      total: prev.total + 1,
    }));
    setBody('');

    try {
      const res = await fetch(`/api/patients/${patientId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ body: trimmedBody }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as PatientNote;

      // Reemplazar optimistic con la nota real del servidor
      setState((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === optimisticId ? created : n)),
      }));
    } catch {
      // Revertir el optimistic update
      setState((prev) => ({
        notes: prev.notes.filter((n) => n.id !== optimisticId),
        total: prev.total - 1,
      }));
      setBody(trimmedBody);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const { notes, total } = state;
  const hasNotes   = total > 0 || notes.length > 0;
  const charCount  = body.length;
  const canSubmit  = body.trim().length > 0 && !submitting;
  const hiddenNotes = total - notes.length;

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      {/* ── Ícono trigger ───────────────────────────────────────────────── */}
      <button
        onClick={toggle}
        title={hasNotes ? `Notas de ${patientName}` : `Agregar nota a ${patientName}`}
        aria-label={`Notas operativas de ${patientName}`}
        aria-expanded={isOpen}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          padding: '2px 4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          color: hasNotes ? '#C4916A' : '#9B8E80',
          flexShrink: 0,
        }}
      >
        <StickyNote size={16} />
        {/* Punto indicador — solo cuando hay notas */}
        {hasNotes && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: '#C4916A',
              border: '1px solid var(--color-surface, #F2F0ED)',
            }}
          />
        )}
      </button>

      {/* ── Popover ─────────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          role="dialog"
          aria-label={`Notas operativas de ${patientName}`}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            width: 320,
            maxWidth: 'calc(100vw - 20px)',
            backgroundColor: '#FFFFFF',
            border: '0.5px solid #E8E2DA',
            borderRadius: 10,
            boxShadow: '0 4px 16px rgba(28,20,16,0.10)',
            zIndex: 200,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '10px 12px 8px',
              borderBottom: '0.5px solid #E8E2DA',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#1C1410' }}>
                {patientName}
              </p>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: '#9B8E80',
                }}
              >
                Notas operativas
              </p>
            </div>
            <button
              onClick={closePopover}
              aria-label="Cerrar notas"
              style={{
                background: 'none',
                border: 'none',
                padding: 2,
                cursor: 'pointer',
                color: '#9B8E80',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Lista de notas */}
          <div
            style={{
              padding: '0 12px',
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {loading ? (
              <p
                style={{
                  margin: '12px 0',
                  fontSize: 12,
                  color: '#9B8E80',
                  textAlign: 'center',
                }}
              >
                Cargando…
              </p>
            ) : notes.length === 0 ? (
              <p style={{ margin: '12px 0', fontSize: 12, color: '#9B8E80' }}>
                Sin notas aún
              </p>
            ) : (
              <>
                {notes.slice(0, expanded ? notes.length : MAX_VISIBLE_NOTES).map((note, i) => {
                  const visibleCount = expanded ? notes.length : Math.min(notes.length, MAX_VISIBLE_NOTES);
                  return (
                    <div
                      key={note.id}
                      style={{
                        padding: '10px 0',
                        borderBottom:
                          i < visibleCount - 1
                            ? '0.5px solid #E8E2DA'
                            : 'none',
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: '#1C1410',
                          lineHeight: 1.6,
                          wordBreak: 'break-word',
                        }}
                      >
                        {note.body}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 10, color: '#9B8E80' }}>
                        {formatRelative(new Date(note.createdAt))}
                      </p>
                    </div>
                  );
                })}

                {/* "Ver N notas más" */}
                {!expanded && hiddenNotes > 0 && (
                  <button
                    onClick={() => fetchNotes(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '6px 0 10px',
                      fontSize: 12,
                      color: '#C4916A',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Ver {hiddenNotes} nota{hiddenNotes > 1 ? 's' : ''} más
                  </button>
                )}
              </>
            )}
          </div>

          {/* Footer — nueva nota */}
          <div
            style={{
              padding: '8px 12px 10px',
              borderTop: '0.5px solid #E8E2DA',
            }}
          >
            <textarea
              ref={textareaRef}
              rows={3}
              maxLength={MAX_BODY_LENGTH}
              placeholder="Ej: Prefiere citas en la mañana, llega puntual..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{
                width: '100%',
                resize: 'none',
                border: '1px solid #E8E2DA',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: 'inherit',
                lineHeight: 1.5,
                outline: 'none',
                boxSizing: 'border-box',
                color: '#1C1410',
                backgroundColor: '#FFFFFF',
              }}
              onFocus={(e) => {
                (e.target as HTMLTextAreaElement).style.borderColor = '#C4916A';
              }}
              onBlur={(e) => {
                (e.target as HTMLTextAreaElement).style.borderColor = '#E8E2DA';
              }}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter para enviar
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddNote();
                }
              }}
            />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 6,
              }}
            >
              <button
                onClick={() => void handleAddNote()}
                disabled={!canSubmit}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#C4916A',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  opacity: canSubmit ? 1 : 0.4,
                  transition: 'opacity 0.15s',
                }}
              >
                {submitting ? 'Guardando…' : 'Agregar nota'}
              </button>

              <span
                style={{
                  fontSize: 11,
                  color: charCountColor(charCount),
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {charCount} / {MAX_BODY_LENGTH}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
