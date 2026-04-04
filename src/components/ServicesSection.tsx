import { Sparkles, MapPin, Home, Syringe, Clock, Shield, type LucideIcon } from 'lucide-react';
import type { Service, ServiceIcon } from '@/lib/content.schema';

// ─── Icon map ─────────────────────────────────────────────────────────────────

const iconMap: Record<ServiceIcon, LucideIcon> = {
  sparkles: Sparkles,
  'map-pin': MapPin,
  home: Home,
  syringe: Syringe,
  clock: Clock,
  shield: Shield,
};

// ─── ServiceCard ──────────────────────────────────────────────────────────────

function ServiceCard({ service }: { service: Service }) {
  const Icon = iconMap[service.icon];

  return (
    <div className="flex gap-5 items-start bg-surface border border-border rounded-card p-5 md:p-6">
      <div className="shrink-0 mt-0.5">
        <Icon size={20} strokeWidth={1.5} className="text-accent" />
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        <h3 className="font-body font-medium text-body-md text-ink">
          {service.name}
        </h3>
        <p className="font-body text-body-sm text-ink-muted leading-relaxed">
          {service.description}
        </p>
        <span className="font-body text-label-sm uppercase tracking-[0.06em] text-accent mt-1">
          {service.duration}
        </span>
      </div>
    </div>
  );
}

// ─── ServicesSection ──────────────────────────────────────────────────────────

interface ServicesSectionProps {
  services: Service[];
}

export function ServicesSection({ services }: ServicesSectionProps) {
  return (
    <section className="bg-canvas border-t border-border px-5 py-16 md:px-10 md:py-20 lg:px-16">
      <div className="mx-auto max-w-2xl flex flex-col gap-10">

        {/* Header */}
        <div className="flex flex-col gap-2">
          <span className="font-body text-label-sm uppercase tracking-[0.08em] text-accent">
            Servicios
          </span>
          <h2 className="font-display text-display-lg text-ink">
            Cómo puedo ayudarte
          </h2>
        </div>

        {/* Stack de tarjetas */}
        <div className="flex flex-col gap-3">
          {services.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>

      </div>
    </section>
  );
}
