import { MessageCircle } from 'lucide-react';
import type { Contact } from '@/lib/content.schema';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StickyWhatsAppBarProps {
  contact: Contact;
}

// ─── Component ────────────────────────────────────────────────────────────────
// Visible solo en móvil (md:hidden). En desktop el CTA del hero es suficiente.
// Fijado al bottom con safe-area padding para dispositivos con notch.

export function StickyWhatsAppBar({ contact }: StickyWhatsAppBarProps) {
  const whatsappUrl = buildWhatsAppUrl(contact.whatsapp, contact.whatsappMessage);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-canvas border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      role="complementary"
      aria-label="Contacto rápido"
    >
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 bg-whatsapp text-whatsapp-fg font-body font-medium text-base rounded-btn py-3.5 transition-opacity active:opacity-80"
      >
        <MessageCircle size={18} strokeWidth={1.75} />
        Agendar sesión
      </a>
    </div>
  );
}
