'use client';

import { useState } from 'react';
import {
  Sparkles,
  MapPin,
  Home,
  Syringe,
  Clock,
  Shield,
  Navigation,
  Building2,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';
import type { MedicalService, ServiceIcon } from '@presenciapro/engine/types';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

// ─── Icon maps ────────────────────────────────────────────────────────────────

const serviceIconMap: Record<ServiceIcon, LucideIcon> = {
  sparkles: Sparkles,
  'map-pin': MapPin,
  home: Home,
  syringe: Syringe,
  clock: Clock,
  shield: Shield,
};

const modeIconMap: Record<string, LucideIcon> = {
  domicilio: Navigation,
  consultorio: Building2,
};

// ─── ServiceCard ──────────────────────────────────────────────────────────────

interface ServiceCardProps {
  service: MedicalService;
  whatsapp: string;
  baseMessage: string;
  isExpanded: boolean;
  onToggle: () => void;
}

function ServiceCard({ service, whatsapp, baseMessage, isExpanded, onToggle }: ServiceCardProps) {
  const Icon = serviceIconMap[service.icon];

  // Mensaje dinámico: reemplaza el servicio en el mensaje base del config
  const serviceMessage = `${baseMessage.replace(/agendar.*$/, `agendar ${service.name}`)}`;
  const whatsappUrl = buildWhatsAppUrl(whatsapp, serviceMessage);

  return (
    <div
      className="flex flex-col bg-surface border border-border rounded-card overflow-hidden transition-shadow hover:shadow-sm"
    >
      {/* ─── Cabecera — siempre visible, clickeable ─────────────────────── */}
      <button
        type="button"
        onClick={onToggle}
        className="flex gap-5 items-start p-5 md:p-6 text-left w-full"
        aria-expanded={isExpanded}
      >
        <div className="shrink-0 mt-0.5">
          <Icon size={20} strokeWidth={1.5} className="text-accent" />
        </div>
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <h3 className="font-body font-medium text-body-md text-ink">
            {service.name}
          </h3>
          <p className="font-body text-body-sm text-ink-muted leading-relaxed">
            {service.description}
          </p>
          {/* Metadatos: duración + modalidades */}
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <span className="font-body text-label-sm uppercase tracking-[0.06em] text-accent">
              {service.durationMinutes} min
            </span>
            <div className="flex items-center gap-1.5">
              {service.modes.map((mode) => {
                const ModeIcon = modeIconMap[mode] ?? MapPin;
                return (
                  <ModeIcon
                    key={mode}
                    size={12}
                    strokeWidth={1.75}
                    className="text-ink-muted"
                    aria-label={mode}
                  />
                );
              })}
            </div>
          </div>
        </div>
        {/* Indicador expand/collapse */}
        <span
          className={[
            'shrink-0 font-body text-label-sm text-ink-muted transition-transform mt-1',
            isExpanded ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        >
          ↓
        </span>
      </button>

      {/* ─── Panel expandido ─────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="px-5 pb-5 md:px-6 md:pb-6 border-t border-border pt-4">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-track={`service-whatsapp-${service.id}`}
            className="inline-flex items-center gap-2 bg-whatsapp text-whatsapp-fg font-body font-medium text-sm rounded-btn px-5 py-3 transition-opacity hover:opacity-90 active:scale-[0.98]"
          >
            <MessageCircle size={16} strokeWidth={1.75} />
            Agendar {service.name}
          </a>
        </div>
      )}
    </div>
  );
}

// ─── ServicesSection ──────────────────────────────────────────────────────────

interface ServicesSectionProps {
  services: MedicalService[];
  contact: { whatsapp: string; whatsappMessage: string };
}

export function ServicesSection({ services, contact }: ServicesSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  // Bento: primer servicio ocupa 2 columnas en desktop si hay ≥2 servicios
  const hasBento = services.length >= 2;

  return (
    <section
      id="servicios"
      className="bg-canvas border-t border-border px-5 py-16 md:px-10 md:py-20 lg:px-16"
    >
      <div className="mx-auto max-w-5xl flex flex-col gap-10">

        {/* Header */}
        <div className="flex flex-col gap-2">
          <span className="font-body text-label-sm uppercase tracking-[0.08em] text-accent">
            Servicios
          </span>
          <h2 className="font-display text-display-lg text-ink">
            Cómo puedo ayudarte
          </h2>
        </div>

        {/* Grid — mobile: stack, desktop: bento 2 columnas */}
        <div className={hasBento ? 'grid lg:grid-cols-2 gap-3' : 'flex flex-col gap-3'}>
          {services.slice(0, 5).map((service, index) => (
            <div
              key={service.id}
              className={hasBento && index === 0 ? 'lg:col-span-2' : undefined}
            >
              <ServiceCard
                service={service}
                whatsapp={contact.whatsapp}
                baseMessage={contact.whatsappMessage}
                isExpanded={expandedId === service.id}
                onToggle={() => toggle(service.id)}
              />
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
