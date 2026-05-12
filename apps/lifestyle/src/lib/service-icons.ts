// ─── Mapa de iconos para servicios ───────────────────────────────────────────
// Infiere el emoji del icono a partir de keywords en el nombre del servicio.
// Normaliza a minúsculas sin acentos para comparación robusta.

const SERVICE_ICON_MAP: Record<string, string> = {
  corte: '✂️',
  fade: '✂️',
  cabello: '✂️',
  barba: '🪒',
  afeitado: '🪒',
  navaja: '🪒',
  bigote: '🪒',
  tinte: '🎨',
  color: '🎨',
  mechas: '🎨',
  tratamiento: '💆',
  masaje: '💆',
  spa: '💆',
  uñas: '💅',
  manicure: '💅',
  pedicure: '💅',
  cejas: '👁️',
  pestañas: '👁️',
};

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function getServiceIcon(serviceName: string): string {
  const normalized = normalize(serviceName);
  for (const [keyword, icon] of Object.entries(SERVICE_ICON_MAP)) {
    if (normalized.includes(normalize(keyword))) {
      return icon;
    }
  }
  return '⭐';
}
