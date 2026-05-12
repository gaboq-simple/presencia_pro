// ─── About Section ────────────────────────────────────────────────────────────
// < 100 chars → statement enorme centrado, mucho aire. Como cita de revista.
// 100+ chars  → línea vertical accent a la izquierda + párrafos con body font.
// Sin descripción → no se renderiza.
// Server Component.

import { RevealObserver } from './RevealObserver';

type AboutSectionProps = {
  description: string | null;
};

export function AboutSection({ description }: AboutSectionProps) {
  if (!description) return null;

  const isShort = description.length < 100;

  if (isShort) {
    return (
      <section
        id="nosotros"
        style={{
          padding: 'clamp(6rem, 11vw, 10rem) clamp(1.5rem, 6vw, 5.5rem)',
          backgroundColor: 'var(--bg)',
        }}
      >
        <RevealObserver />
        <p className="about-statement reveal">
          {description}
        </p>
      </section>
    );
  }

  return (
    <section
      id="nosotros"
      className="site-section"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <RevealObserver />

      <div className="reveal">
        <p className="site-section-label">Quienes somos</p>
        <h2 className="site-section-title">Nosotros</h2>
      </div>

      <div
        className="about-long reveal reveal-delay-1"
        style={{ marginTop: '3rem' }}
      >
        <div className="about-long__line" aria-hidden />
        <div className="about-long__text">
          {description.split('\n').filter(Boolean).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
