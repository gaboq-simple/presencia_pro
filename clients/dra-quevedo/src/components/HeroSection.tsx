import Image from 'next/image';
import { MessageCircle, MapPin, CheckCircle2 } from 'lucide-react';
import type { Specialist } from '@presenciapro/engine/types';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceModeItem {
  label: string;
  detail: string;
}

interface HeroSectionProps {
  specialist: Pick<Specialist, 'name' | 'photo' | 'tagline' | 'credentials' | 'location'>;
  specialty: string;
  contact: { whatsapp: string; whatsappMessage: string };
  serviceModes: ServiceModeItem[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HeroSection({ specialist, specialty, contact, serviceModes }: HeroSectionProps) {
  const whatsappUrl = buildWhatsAppUrl(contact.whatsapp, contact.whatsappMessage);

  return (
    <section id="hero" className="bg-canvas px-5 pt-14 pb-32 md:px-10 md:pt-24 md:pb-24 lg:px-16">
      <div className="mx-auto max-w-5xl grid md:grid-cols-[1fr_360px] gap-10 md:gap-16 items-center">

        {/* ─── Foto — mobile: primera, desktop: derecha ──────────────────── */}
        <div className="order-first md:order-last flex justify-center md:justify-end">
          <div className="relative w-52 h-64 md:w-full md:h-auto md:aspect-[3/4] rounded-card overflow-hidden bg-surface border border-border">
            <Image
              src={specialist.photo}
              alt={`Foto de ${specialist.name}`}
              fill
              className="object-cover object-top"
              priority
              sizes="(max-width: 768px) 208px, 360px"
            />
          </div>
        </div>

        {/* ─── Texto ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Especialidad — eyebrow */}
          <span className="font-body text-label-sm uppercase tracking-[0.08em] text-accent">
            {specialty}
          </span>

          {/* Nombre */}
          <h1 className="font-display text-display-xl text-ink">
            {specialist.name}
          </h1>

          {/* Ubicación */}
          <div className="flex items-center gap-1.5">
            <MapPin size={13} strokeWidth={1.5} className="text-accent shrink-0" />
            <span className="font-body text-body-sm text-ink-muted">
              {specialist.location}
            </span>
          </div>

          {/* Tagline */}
          <p className="font-body text-body-lg text-ink-muted max-w-md">
            {specialist.tagline}
          </p>

          {/* Modalidades de servicio */}
          <div className="flex flex-col gap-2 pt-1">
            {serviceModes.map((mode) => (
              <div key={mode.label} className="flex items-center gap-2.5">
                <span
                  className="w-1 h-1 rounded-full bg-accent shrink-0"
                  aria-hidden="true"
                />
                <span className="font-body text-body-sm text-ink-muted">
                  {mode.label} ({mode.detail})
                </span>
              </div>
            ))}
          </div>

          {/* Credenciales */}
          <div className="flex flex-wrap gap-2 pt-1">
            {specialist.credentials.map((cred) => (
              <span
                key={cred}
                className="inline-flex items-center gap-1.5 bg-surface border border-border rounded-badge font-body text-label-sm uppercase tracking-[0.06em] text-ink-muted px-3 py-1.5"
              >
                <CheckCircle2 size={11} strokeWidth={2} className="text-accent" />
                {cred}
              </span>
            ))}
          </div>

          {/* CTAs */}
          <div className="mt-3 flex flex-col sm:flex-row gap-3">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-track="hero-whatsapp"
              className="inline-flex w-full sm:w-fit items-center justify-center gap-2.5 bg-whatsapp text-whatsapp-fg font-body font-medium text-base rounded-btn px-8 py-4 transition-opacity hover:opacity-90 active:scale-[0.98]"
            >
              <MessageCircle size={19} strokeWidth={1.75} />
              Agendar por WhatsApp
            </a>
            <a
              href="#servicios"
              data-track="hero-services"
              className="inline-flex w-full sm:w-fit items-center justify-center gap-2 font-body font-medium text-base text-ink-muted rounded-btn px-8 py-4 border border-border hover:border-accent hover:text-ink transition-colors"
            >
              Ver servicios
            </a>
          </div>

        </div>
      </div>
    </section>
  );
}
