'use client';

// ─── PatientAttentionList ──────────────────────────────────────────────────────
// Lista de pacientes que requieren atención (en riesgo de abandono).
// Avatar círculo 30px con iniciales, badge pill 10px por status.

import type { SerializedAtRiskPatient } from './types';

export type PatientAttentionListProps = {
  readonly patients: readonly SerializedAtRiskPatient[];
};

function Avatar({ initials }: { initials: string }) {
  return (
    <div
      style={{
        width: '30px',
        height: '30px',
        borderRadius: '50%',
        backgroundColor: 'var(--an-surf)',
        color: 'var(--an-t2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

type PatientStatus = 'new' | 'at-risk' | 'active';

function StatusBadge({ status }: { status: PatientStatus }) {
  const styles: Record<PatientStatus, { bg: string; color: string; label: string }> = {
    new:      { bg: 'var(--an-acL)',  color: 'var(--an-acD)',  label: 'Nuevo' },
    'at-risk': { bg: 'var(--an-ambL)', color: 'var(--an-ambD)', label: 'En riesgo' },
    active:   { bg: 'var(--an-grnL)', color: 'var(--an-grnD)', label: 'Activo' },
  };
  const s = styles[status];
  return (
    <span
      style={{
        padding: '2px 7px',
        borderRadius: '10px',
        backgroundColor: s.bg,
        color: s.color,
        fontSize: '10px',
        fontWeight: 500,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

export function PatientAttentionList({ patients }: PatientAttentionListProps) {
  return (
    <div
      style={{
        backgroundColor: 'var(--an-card)',
        borderRadius: '10px',
        border: '1px solid var(--an-br)',
        padding: '1rem 1.125rem',
      }}
    >
      <p
        style={{
          margin: '0 0 10px',
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--an-t1)',
          letterSpacing: '-0.01em',
        }}
      >
        Pacientes a reactivar
      </p>

      {patients.length === 0 ? (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--an-t3)' }}>
          Sin pacientes en riesgo — ¡todos activos!
        </p>
      ) : (
        <div>
          {patients.map((patient, idx) => (
            <div
              key={patient.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 0',
                borderTop: idx > 0 ? '1px solid var(--an-surf2)' : 'none',
              }}
            >
              <Avatar initials={patient.initials} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--an-t1)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {patient.name}
                </p>
                <p
                  style={{
                    margin: '2px 0 0',
                    fontSize: '11px',
                    color: 'var(--an-t3)',
                  }}
                >
                  {patient.daysSinceLastVisit} días sin cita
                </p>
              </div>

              <StatusBadge status="at-risk" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
