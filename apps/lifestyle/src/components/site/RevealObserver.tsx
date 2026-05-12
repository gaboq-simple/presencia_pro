'use client';

// ─── RevealObserver ───────────────────────────────────────────────────────────
// Agrega la clase 'visible' a todos los elementos .reveal que entren
// al viewport. Cleanup automático en desmontaje.
// Cero librerías de animación — Intersection Observer + CSS.

import { useEffect } from 'react';

export function RevealObserver() {
  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>('.reveal');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target); // una sola vez
          }
        });
      },
      { threshold: 0.12 },
    );

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return null;
}
