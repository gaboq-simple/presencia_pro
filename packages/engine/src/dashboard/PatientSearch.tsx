'use client';

// ─── PatientSearch ─────────────────────────────────────────────────────────────
// Expandable search bar for the dashboard header.
// Collapsed: single Search icon button.
// Expanded: 280px input with debounced search (300ms, min 2 chars).
// Results: dropdown of up to 6 patients.
// Selection: calls onSelect(patientId) and collapses.

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import type { PatientSearchResult } from './types';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PatientSearchProps = {
  readonly clientId: string;
  readonly onSelect: (patientId: string) => void;
  readonly authToken?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── ResultItem ────────────────────────────────────────────────────────────────

function ResultItem({
  result,
  onSelect,
  isLast,
}: {
  result: PatientSearchResult;
  onSelect: () => void;
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const contactDisplay = result.phone ?? result.whatsappId;

  return (
    <button
      onMouseDown={(e) => e.preventDefault()} // Prevent blur before click
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        width: '100%',
        padding: '0.625rem 0.875rem',
        backgroundColor: hovered ? '#F2EEE8' : '#FFFFFF',
        border: 'none',
        borderBottom: isLast ? 'none' : '1px solid #E8E2DA',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color 0.1s',
      }}
    >
      {/* ── Initials circle ─────────────────────────────────────────────── */}
      <div
        style={{
          width: '2rem',
          height: '2rem',
          borderRadius: '50%',
          backgroundColor: '#C4916A',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.6875rem',
          fontWeight: 700,
          flexShrink: 0,
          letterSpacing: '0.04em',
        }}
      >
        {getInitials(result.name)}
      </div>

      {/* ── Patient info ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            fontWeight: 600,
            color: '#1C1410',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {result.name}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: '0.75rem',
            color: '#9B8E80',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {contactDisplay}
          {result.lastServiceName && result.lastVisit && (
            <> · {result.lastServiceName} ({formatRelativeDate(result.lastVisit)})</>
          )}
        </p>
      </div>
    </button>
  );
}

// ─── SkeletonResults ───────────────────────────────────────────────────────────

function SkeletonResults() {
  return (
    <>
      {[1, 2, 3].map((i, idx) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            padding: '0.625rem 0.875rem',
            borderBottom: idx < 2 ? '1px solid #E8E2DA' : 'none',
          }}
        >
          <div
            style={{
              width: '2rem',
              height: '2rem',
              borderRadius: '50%',
              backgroundColor: '#F2EEE8',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <div style={{ height: '0.75rem', width: '55%', backgroundColor: '#F2EEE8', borderRadius: '0.25rem' }} />
            <div style={{ height: '0.625rem', width: '35%', backgroundColor: '#F2EEE8', borderRadius: '0.25rem' }} />
          </div>
        </div>
      ))}
    </>
  );
}

// ─── PatientSearch ─────────────────────────────────────────────────────────────

export function PatientSearch({ onSelect, authToken }: PatientSearchProps) {
  const [expanded, setExpanded]   = useState(false);
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<PatientSearchResult[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const inputRef      = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Focus input when expanded ──────────────────────────────────────────────
  useEffect(() => {
    if (expanded) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [expanded]);

  // ── Debounced search ───────────────────────────────────────────────────────
  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        setShowDropdown(false);
        return;
      }

      setLoading(true);
      setError(null);
      setShowDropdown(true);

      try {
        const res = await fetch(
          `/api/patients/search?q=${encodeURIComponent(q)}`,
          authToken
            ? { headers: { Authorization: `Bearer ${authToken}` } }
            : {},
        );

        if (!res.ok) {
          const body = await res.json() as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json() as PatientSearchResult[];
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al buscar');
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [authToken],
  );

  function handleQueryChange(value: string) {
    setQuery(value);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (value.length < 2) {
      setResults([]);
      setShowDropdown(false);
      setError(null);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      void doSearch(value);
    }, 300);
  }

  function handleCollapse() {
    setExpanded(false);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
    setError(null);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') handleCollapse();
  }

  function handleBlur() {
    // Delay to allow ResultItem click to register
    setTimeout(() => {
      setShowDropdown(false);
    }, 150);
  }

  function handleSelect(patientId: string) {
    onSelect(patientId);
    handleCollapse();
  }

  // ── Collapsed state: icon button ──────────────────────────────────────────
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        aria-label="Buscar paciente"
        title="Buscar paciente"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.375rem',
          backgroundColor: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: '0.375rem',
          cursor: 'pointer',
          color: 'var(--color-ink-muted)',
          transition: 'background-color 0.15s',
        }}
      >
        <Search size={18} />
      </button>
    );
  }

  // ── Expanded state: input + dropdown ──────────────────────────────────────
  return (
    <div style={{ position: 'relative' }}>
      {/* ── Input wrapper ───────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: '280px',
          padding: '0.375rem 0.625rem',
          backgroundColor: '#FFFFFF',
          border: '1.5px solid #C4916A',
          borderRadius: '0.375rem',
          transition: 'width 0.2s ease',
        }}
      >
        <Search size={16} style={{ color: '#C4916A', flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="Buscar paciente…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: '0.875rem',
            color: '#1C1410',
            backgroundColor: 'transparent',
          }}
        />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCollapse}
          aria-label="Cerrar búsqueda"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.125rem',
            color: '#9B8E80',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Dropdown ────────────────────────────────────────────────────── */}
      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.375rem)',
            left: 0,
            width: '320px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #E8E2DA',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 12px rgba(28,20,16,0.08)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {loading && <SkeletonResults />}

          {!loading && error && (
            <p
              style={{
                margin: 0,
                padding: '0.75rem 0.875rem',
                fontSize: '0.8125rem',
                color: '#991B1B',
              }}
            >
              Error al buscar — intenta de nuevo
            </p>
          )}

          {!loading && !error && results.length === 0 && query.length >= 2 && (
            <p
              style={{
                margin: 0,
                padding: '0.75rem 0.875rem',
                fontSize: '0.8125rem',
                color: '#9B8E80',
              }}
            >
              Sin resultados para &ldquo;{query}&rdquo;
            </p>
          )}

          {!loading && !error && results.length > 0 &&
            results.map((r, idx) => (
              <ResultItem
                key={r.id}
                result={r}
                onSelect={() => handleSelect(r.id)}
                isLast={idx === results.length - 1}
              />
            ))}
        </div>
      )}
    </div>
  );
}
