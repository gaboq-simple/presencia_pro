import { ContentSchema } from '@/lib/content.schema';
import { HeroSection } from '@/components/HeroSection';
import { ServicesSection } from '@/components/ServicesSection';
import { ServiceModeSection } from '@/components/ServiceModeSection';
import { ContactSection } from '@/components/ContactSection';
import { StickyWhatsAppBar } from '@/components/StickyWhatsAppBar';
import rawContent from '@/content/content.json';

// Guard: parse valida en build time — lanza ZodError si content.json es inválido.
const content = ContentSchema.parse(rawContent);

export default function Home() {
  return (
    <main className="bg-canvas min-h-svh">
      <HeroSection doctor={content.doctor} contact={content.contact} />
      <ServicesSection services={content.services} />
      <ServiceModeSection serviceMode={content.doctor.serviceMode} />
      <ContactSection doctor={content.doctor} contact={content.contact} />
      <StickyWhatsAppBar contact={content.contact} />
    </main>
  );
}
