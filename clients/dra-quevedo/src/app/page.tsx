import { clientConfig } from '@/config/client.config';
import { HeroSection } from '@/components/HeroSection';
import { TrustContext } from '@/components/TrustContext';
import { ServicesSection } from '@/components/ServicesSection';
import { EnvironmentSection } from '@/components/EnvironmentSection';
import { ContactSection } from '@/components/ContactSection';
import { StickyWhatsAppBar } from '@/components/StickyWhatsAppBar';

// ─── Data wiring ──────────────────────────────────────────────────────────────
// page.tsx es el único lugar donde clientConfig se convierte en props.
// Los componentes son presenters puros — no importan clientConfig directamente.

const specialist = clientConfig.specialists[0]!;

const heroServiceModes = [
  {
    label: clientConfig.serviceModes.domicilio.label,
    detail: clientConfig.serviceModes.domicilio.availableZones.join(', '),
  },
  {
    label: clientConfig.serviceModes.consultorio.label,
    detail: clientConfig.serviceModes.consultorio.address,
  },
];

export default function Home() {
  return (
    <main className="bg-canvas min-h-svh">

      {/* 1. Hero ────────────────────────────────────────────────────────────── */}
      <HeroSection
        specialist={specialist}
        specialty={clientConfig.client.specialty}
        contact={clientConfig.contact}
        serviceModes={heroServiceModes}
      />

      {/* 2. Trust Context ───────────────────────────────────────────────────── */}
      <TrustContext
        credentials={specialist.credentials}
        yearsExperience={specialist.yearsExperience}
        serviceModes={{
          domicilio: {
            label: clientConfig.serviceModes.domicilio.label,
            availableZones: clientConfig.serviceModes.domicilio.availableZones,
          },
          consultorio: {
            label: clientConfig.serviceModes.consultorio.label,
            description: clientConfig.serviceModes.consultorio.description,
          },
        }}
      />

      {/* 3. Services ────────────────────────────────────────────────────────── */}
      <ServicesSection
        services={clientConfig.services}
        contact={clientConfig.contact}
      />

      {/* 4. Environment ─────────────────────────────────────────────────────── */}
      <EnvironmentSection
        photo={specialist.photo}
        specialistName={specialist.name}
        caption={clientConfig.serviceModes.consultorio.description}
      />

      {/* 5. Contact ─────────────────────────────────────────────────────────── */}
      <ContactSection
        specialistName={specialist.name}
        address={clientConfig.serviceModes.consultorio.address}
        contact={{
          whatsapp: clientConfig.contact.whatsapp,
          whatsappMessage: clientConfig.contact.whatsappMessage,
          googleMapsUrl: clientConfig.serviceModes.consultorio.googleMapsUrl,
          instagram: clientConfig.contact.instagram,
          tiktok: clientConfig.contact.tiktok,
        }}
      />

      {/* Sticky bar — Client Component, solo móvil, aparece tras scroll del Hero */}
      <StickyWhatsAppBar contact={clientConfig.contact} />

    </main>
  );
}
