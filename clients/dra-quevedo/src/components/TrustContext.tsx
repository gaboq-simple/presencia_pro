import { Navigation, Building2, CheckCircle2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrustContextProps {
  credentials: string[];
  yearsExperience: number | null | undefined;
  serviceModes: {
    domicilio: { label: string; availableZones: string[] };
    consultorio: { label: string; description: string };
  };
}

// ─── TrustContext ─────────────────────────────────────────────────────────────
// Autoridad escaneable en ≤10 segundos.
// Desktop (lg): bento grid — stats + modalidades en fila, credenciales y zonas abajo.
// Mobile: stack vertical.

export function TrustContext({ credentials, yearsExperience, serviceModes }: TrustContextProps) {
  const hasExperience = typeof yearsExperience === 'number' && yearsExperience > 0;
  // Guard: máx. 3 credenciales visibles
  const visibleCredentials = credentials.slice(0, 3);

  return (
    <section className="bg-surface border-t border-border px-5 py-16 md:px-10 md:py-20 lg:px-16">
      <div className="mx-auto max-w-5xl flex flex-col gap-10">

        {/* Header */}
        <div className="flex flex-col gap-2">
          <span className="font-body text-label-sm uppercase tracking-[0.08em] text-accent">
            Formación y experiencia
          </span>
          <h2 className="font-display text-display-lg text-ink">
            Quién te atiende
          </h2>
        </div>

        {/* ─── Bento grid ───────────────────────────────────────────────────── */}
        <div className="grid gap-3 lg:grid-cols-3">

          {/* Años de experiencia — solo si yearsExperience tiene valor */}
          {hasExperience && (
            <div className="flex flex-col justify-center gap-1 bg-canvas border border-border rounded-card p-6">
              <span className="font-display text-display-xl text-accent leading-none">
                {yearsExperience}
              </span>
              <span className="font-body text-body-sm text-ink-muted">
                años de experiencia
              </span>
            </div>
          )}

          {/* Modalidades — ocupa 2 columnas si no hay stat de años */}
          <div
            className={[
              'flex flex-col gap-3',
              hasExperience ? 'lg:col-span-2' : 'lg:col-span-3',
            ].join(' ')}
          >
            <div className="grid sm:grid-cols-2 gap-3 h-full">

              {/* Domicilio */}
              <div className="flex items-start gap-4 bg-canvas border border-border rounded-card p-5">
                <Navigation
                  size={20}
                  strokeWidth={1.5}
                  className="text-accent shrink-0 mt-0.5"
                />
                <div className="flex flex-col gap-1">
                  <p className="font-body font-medium text-body-md text-ink">
                    {serviceModes.domicilio.label}
                  </p>
                  <p className="font-body text-body-sm text-ink-muted">
                    {serviceModes.domicilio.availableZones.join(' · ')}
                  </p>
                </div>
              </div>

              {/* Consultorio */}
              <div className="flex items-start gap-4 bg-canvas border border-border rounded-card p-5">
                <Building2
                  size={20}
                  strokeWidth={1.5}
                  className="text-accent shrink-0 mt-0.5"
                />
                <div className="flex flex-col gap-1">
                  <p className="font-body font-medium text-body-md text-ink">
                    {serviceModes.consultorio.label}
                  </p>
                  <p className="font-body text-body-sm text-ink-muted">
                    {serviceModes.consultorio.description}
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* Credenciales — fila completa */}
          {visibleCredentials.length > 0 && (
            <div className="lg:col-span-3 flex flex-wrap gap-2">
              {visibleCredentials.map((cred) => (
                <span
                  key={cred}
                  className="inline-flex items-center gap-1.5 bg-canvas border border-border rounded-badge font-body text-label-sm uppercase tracking-[0.06em] text-ink-muted px-3 py-1.5"
                >
                  <CheckCircle2 size={11} strokeWidth={2} className="text-accent" />
                  {cred}
                </span>
              ))}
            </div>
          )}

        </div>
      </div>
    </section>
  );
}
