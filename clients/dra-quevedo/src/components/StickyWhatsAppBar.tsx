'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StickyWhatsAppBarProps {
  contact: { whatsapp: string; whatsappMessage: string };
}

// ─── Component ────────────────────────────────────────────────────────────────
// Visible solo en móvil (md:hidden). Aparece cuando el Hero (#hero) sale del viewport.
// IntersectionObserver: cuando el hero deja de intersectar, la barra se muestra.
// Guard: si #hero no existe en el DOM, la barra se muestra siempre.
// Safe-area padding para dispositivos con notch.

export function StickyWhatsAppBar({ contact }: StickyWhatsAppBarProps) {
  const whatsappUrl = buildWhatsAppUrl(contact.whatsapp, contact.whatsappMessage);
  const [visible, setVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const hero = document.getElementById('hero');
    if (!hero) {
      setVisible(true);
      return;
    }

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        setVisible(!entry.isIntersecting);
      },
      { threshold: 0 },
    );

    observerRef.current.observe(hero);

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  if (!visible) return null;

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
        data-track="sticky-whatsapp"
        className="flex w-full items-center justify-center gap-2 bg-whatsapp text-whatsapp-fg font-body font-medium text-base rounded-btn py-3.5 transition-opacity active:opacity-80"
      >
        <MessageCircle size={18} strokeWidth={1.75} />
        Agendar con la Dra.
      </a>
    </div>
  );
}
