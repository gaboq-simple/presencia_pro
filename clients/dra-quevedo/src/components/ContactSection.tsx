import { MessageCircle, MapPin, ExternalLink, AtSign } from 'lucide-react';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactSectionProps {
  specialistName: string;
  /** Dirección del consultorio — desde serviceModes.consultorio.address */
  address: string;
  contact: {
    whatsapp: string;
    whatsappMessage: string;
    googleMapsUrl: string;
    instagram: string;
    tiktok: string;
  };
}

// ─── ContactSection ───────────────────────────────────────────────────────────
// Sección de cierre — fondo surface para marcar el fin del contenido principal.
// Redes sociales y Maps solo renderizan si la URL en config no está vacía.

export function ContactSection({ specialistName, address, contact }: ContactSectionProps) {
  const whatsappUrl = buildWhatsAppUrl(contact.whatsapp, contact.whatsappMessage);

  const hasMaps = contact.googleMapsUrl !== '';
  const hasInstagram = contact.instagram !== '';
  const hasTiktok = contact.tiktok !== '';
  const hasSocial = hasInstagram || hasTiktok;

  return (
    <section className="bg-surface border-t border-border px-5 py-16 pb-36 md:px-10 md:py-20 md:pb-20 lg:px-16">
      <div className="mx-auto max-w-2xl flex flex-col gap-8">

        {/* Header */}
        <div className="flex flex-col gap-2">
          <span className="font-body text-label-sm uppercase tracking-[0.08em] text-accent">
            Contacto
          </span>
          <h2 className="font-display text-display-lg text-ink">
            Agenda tu sesión
          </h2>
          <p className="font-body text-body-lg text-ink-muted max-w-sm">
            Escríbeme directamente por WhatsApp y con gusto te atiendo.
          </p>
        </div>

        {/* CTA WhatsApp */}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-track="contact-whatsapp"
          className="inline-flex w-full md:w-fit items-center justify-center gap-2.5 bg-whatsapp text-whatsapp-fg font-body font-medium text-base rounded-btn px-8 py-4 transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          <MessageCircle size={19} strokeWidth={1.75} />
          Escribir por WhatsApp
        </a>

        {/* Ubicación */}
        <div className="flex items-start gap-2">
          <MapPin size={14} strokeWidth={1.5} className="text-accent shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-body text-body-sm text-ink">{specialistName}</span>
            <span className="font-body text-body-sm text-ink-muted">{address}</span>
            {hasMaps && (
              <a
                href={contact.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-track="contact-maps"
                className="inline-flex items-center gap-1 font-body text-label-sm uppercase tracking-[0.06em] text-accent mt-1 hover:underline underline-offset-2"
              >
                Ver en Google Maps
                <ExternalLink size={10} strokeWidth={1.75} />
              </a>
            )}
          </div>
        </div>

        {/* Redes sociales — solo si tienen URL en config */}
        {hasSocial && (
          <div className="flex items-center gap-4">
            {hasInstagram && (
              <a
                href={contact.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-body text-body-sm text-ink-muted hover:text-ink transition-colors"
                aria-label="Instagram"
              >
                <AtSign size={16} strokeWidth={1.5} />
                Instagram
              </a>
            )}
            {hasTiktok && (
              <a
                href={contact.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-body text-body-sm text-ink-muted hover:text-ink transition-colors"
                aria-label="TikTok"
              >
                <ExternalLink size={16} strokeWidth={1.5} />
                TikTok
              </a>
            )}
          </div>
        )}

      </div>
    </section>
  );
}
