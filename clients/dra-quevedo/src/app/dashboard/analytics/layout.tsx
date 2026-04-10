// ─── Analytics Layout ──────────────────────────────────────────────────────────
// Layout exclusivo para /dashboard/analytics.
// Sobreescribe el maxWidth del dashboard principal (48rem) para permitir
// el grid de múltiples columnas del dashboard de analytics.
// Hereda la sesión verificada del DashboardLayout padre — no duplica auth.

import { clientConfig } from '@/config/client.config';

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Leer tokens de analytics desde el config del cliente
  const an = clientConfig.design.analytics;

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: an ? an.pg : 'var(--an-pg)',
        minHeight: 0,
      }}
    >
      {/* Inyectar tokens de analytics como CSS variables en este subtree */}
      {an && (
        <style>{`
          .analytics-root {
            --an-pg:    ${an.pg};
            --an-card:  ${an.card};
            --an-surf:  ${an.surf};
            --an-surf2: ${an.surf2};
            --an-t1:    ${an.t1};
            --an-t2:    ${an.t2};
            --an-t3:    ${an.t3};
            --an-br:    ${an.br};
            --an-br2:   ${an.br2};
            --an-ac:    ${an.ac};
            --an-acL:   ${an.acL};
            --an-acD:   ${an.acD};
            --an-grn:   ${an.grn};
            --an-grnL:  ${an.grnL};
            --an-grnD:  ${an.grnD};
            --an-amb:   ${an.amb};
            --an-ambL:  ${an.ambL};
            --an-ambD:  ${an.ambD};
            --an-red:   ${an.red};
            --an-redL:  ${an.redL};
            --an-redD:  ${an.redD};
            --an-hmLo:  ${an.hmLo};
            --an-hmMd:  ${an.hmMd};
            --an-hmHi:  ${an.hmHi};
          }
        `}</style>
      )}
      <div
        className="analytics-root"
        style={{
          maxWidth: '72rem',
          width: '100%',
          margin: '0 auto',
          padding: '1.25rem',
        }}
      >
        {children}
      </div>
    </div>
  );
}
