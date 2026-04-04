import Image from 'next/image';
import { MessageCircle, MapPin, CheckCircle2 } from 'lucide-react';
import type { Doctor, Contact } from '@/lib/content.schema';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HeroSectionProps {
  doctor: Doctor;
  contact: Contact;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HeroSection({ doctor, contact }: HeroSectionProps) {
  const whatsappUrl = buildWhatsAppUrl(contact.whatsapp, contact.whatsappMessage);

  return (
    <section className="bg-canvas px-5 pt-14 pb-32 md:px-10 md:pt-24 md:pb-24 lg:px-16">
      <div className="mx-auto max-w-5xl grid md:grid-cols-[1fr_360px] gap-10 md:gap-16 items-center">

        {/* ─── Foto — mobile: primera, desktop: derecha ──────────────────── */}
        <div className="order-first md:order-last flex justify-center md:justify-end">
          <div className="relative w-52 h-64 md:w-full md:h-auto md:aspect-[3/4] rounded-card overflow-hidden bg-surface border border-border">
            <Image
              src={doctor.photo}
              alt={`Foto de ${doctor.name}`}
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
            {doctor.specialty}
          </span>

          {/* Nombre */}
          <h1 className="font-display text-display-xl text-ink">
            {doctor.name}
          </h1>

          {/* Ubicación */}
          <div className="flex items-center gap-1.5">
            <MapPin size={13} strokeWidth={1.5} className="text-accent shrink-0" />
            <span className="font-body text-body-sm text-ink-muted">
              {doctor.location}
            </span>
          </div>

          {/* Tagline */}
          <p className="font-body text-body-lg text-ink-muted max-w-md">
            {doctor.tagline}
          </p>

          {/* Modalidades de servicio */}
          <div className="flex flex-col gap-2 pt-1">
            {doctor.serviceMode.map((mode) => (
              <div key={mode} className="flex items-center gap-2.5">
                <span
                  className="w-1 h-1 rounded-full bg-accent shrink-0"
                  aria-hidden="true"
                />
                <span className="font-body text-body-sm text-ink-muted">{mode}</span>
              </div>
            ))}
          </div>

          {/* Credenciales */}
          <div className="flex flex-wrap gap-2 pt-1">
            {doctor.credentials.map((cred) => (
              <span
                key={cred}
                className="inline-flex items-center gap-1.5 bg-surface border border-border rounded-badge font-body text-label-sm uppercase tracking-[0.06em] text-ink-muted px-3 py-1.5"
              >
                <CheckCircle2 size={11} strokeWidth={2} className="text-accent" />
                {cred}
              </span>
            ))}
          </div>

          {/* CTA WhatsApp */}
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex w-full md:w-fit items-center justify-center gap-2.5 bg-whatsapp text-whatsapp-fg font-body font-medium text-base rounded-btn px-8 py-4 transition-opacity hover:opacity-90 active:scale-[0.98]"
          >
            <MessageCircle size={19} strokeWidth={1.75} />
            Agendar por WhatsApp
          </a>

        </div>
      </div>
    </section>
  );
}
