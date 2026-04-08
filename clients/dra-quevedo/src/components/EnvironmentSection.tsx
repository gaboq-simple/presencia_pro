import Image from 'next/image';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnvironmentSectionProps {
  photo: string;
  specialistName: string;
  caption: string;
}

// ─── EnvironmentSection ───────────────────────────────────────────────────────
// Señal de calidad. Una imagen + una línea de ancla. Sin texto largo.
// La imagen ocupa el ancho completo del contenedor con aspect ratio controlado.

export function EnvironmentSection({ photo, specialistName, caption }: EnvironmentSectionProps) {
  return (
    <section className="bg-canvas border-t border-border px-5 py-16 md:px-10 md:py-20 lg:px-16">
      <div className="mx-auto max-w-5xl flex flex-col gap-6">

        {/* Imagen */}
        <div className="relative w-full aspect-[4/3] md:aspect-[16/7] rounded-card overflow-hidden bg-surface">
          <Image
            src={photo}
            alt={`Espacio de trabajo de ${specialistName}`}
            fill
            className="object-cover object-center"
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 90vw, 1024px"
          />
        </div>

        {/* Línea de ancla */}
        <p className="font-body text-body-md text-ink-muted max-w-lg">
          {caption}
        </p>

      </div>
    </section>
  );
}
