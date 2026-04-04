import { Navigation, Building2, type LucideIcon } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Separa "A domicilio (CDMX y zona oriente EdoMex)" en { main, detail }
function parseModeString(mode: string): { main: string; detail: string | null } {
  const match = mode.match(/^([^(]+?)(?:\s*\(([^)]+)\))?$/);
  return {
    main: match?.[1]?.trim() ?? mode,
    detail: match?.[2]?.trim() ?? null,
  };
}

// Íconos ordenados — el primero aplica al modo[0], el segundo al modo[1], etc.
const MODE_ICONS: LucideIcon[] = [Navigation, Building2];

// ─── ServiceModeSection ───────────────────────────────────────────────────────

interface ServiceModeSectionProps {
  serviceMode: string[];
}

export function ServiceModeSection({ serviceMode }: ServiceModeSectionProps) {
  return (
    <section className="bg-canvas border-t border-border px-5 py-16 md:px-10 md:py-20 lg:px-16">
      <div className="mx-auto max-w-2xl flex flex-col gap-10">

        {/* Header */}
        <div className="flex flex-col gap-2">
          <span className="font-body text-label-sm uppercase tracking-[0.08em] text-accent">
            Modalidad
          </span>
          <h2 className="font-display text-display-lg text-ink">
            Donde tú elijas
          </h2>
        </div>

        {/* Bloques de modalidad — stack en móvil, 2 columnas en desktop */}
        <div className="grid md:grid-cols-2 gap-3">
          {serviceMode.map((mode, i) => {
            const { main, detail } = parseModeString(mode);
            const Icon = MODE_ICONS[i] ?? Navigation;

            return (
              <div
                key={mode}
                className="flex flex-col gap-4 bg-surface border border-border rounded-card p-6"
              >
                <Icon size={22} strokeWidth={1.5} className="text-accent" />
                <div className="flex flex-col gap-1">
                  <p className="font-body font-medium text-body-md text-ink">
                    {main}
                  </p>
                  {detail !== null && (
                    <p className="font-body text-body-sm text-ink-muted">
                      {detail}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
