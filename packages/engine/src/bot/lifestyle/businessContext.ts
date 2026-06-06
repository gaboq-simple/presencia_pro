// ─── Lifestyle Bot — Business Context Builder ─────────────────────────────────
// Capa de CABLEADO: convierte los datos reales del negocio (tenant) en bloques de
// contexto estructurado para inyectarlos al system prompt y a las respuestas de
// side-questions (precio, horarios, ubicación, duración, servicios, reseñas).
//
// REGLAS DE DISEÑO (críticas — ver S4-BOT-04):
//   - 100% PURA y DETERMINISTA: NO consulta DB, NO lee process.env, NO toca red.
//     Todo lo que necesita entra por parámetros (objetos en memoria).
//   - El link al minisite (NEXT_PUBLIC_APP_URL/{slug}) se construye con `appUrl`
//     pasado por el caller; así los tests pueden fijarlo sin red.
//   - Solo importa TIPOS (erasable) → seguro de importar en tests sin arrastrar
//     el SDK de Anthropic ni Supabase.

import type { LifestyleBusinessConfig, ServiceRow, OfficeHours } from './types';

// ─── Opciones ─────────────────────────────────────────────────────────────────

export type BusinessContextOptions = {
  /** Base del minisite, normalmente process.env.NEXT_PUBLIC_APP_URL. */
  readonly appUrl?: string;
};

export type SideQuestionTopic =
  | 'price' | 'hours' | 'location' | 'duration' | 'services' | 'reviews' | 'other';

// ─── Días de la semana (office_hours: clave "0"–"6", domingo=0) ───────────────

const DAY_NAMES: Record<string, string> = {
  '0': 'Domingo',
  '1': 'Lunes',
  '2': 'Martes',
  '3': 'Miércoles',
  '4': 'Jueves',
  '5': 'Viernes',
  '6': 'Sábado',
};
const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

// ─── Helpers de formato ───────────────────────────────────────────────────────

function formatMoney(n: number): string {
  return `$${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
}

/**
 * Formatea el precio de un servicio en lenguaje natural soportando rango/aprox.
 * Semántica (alineada con migración 039):
 *   - price_min + price_max → "$X a $Y"
 *   - solo price_min        → "desde $X"
 *   - price exacto (>0)     → "$X"
 *   - sin info de precio     → "precio a consultar"
 * Si existe price_note, se anexa al final ("$X aprox", "$X a $Y según largo").
 */
export function formatServicePrice(svc: ServiceRow): string {
  const note = svc.price_note?.trim();
  const suffix = note ? ` ${note}` : '';

  const min = svc.price_min ?? null;
  const max = svc.price_max ?? null;

  let base: string;
  if (min != null && max != null && max > min) {
    base = `${formatMoney(min)} a ${formatMoney(max)}`;
  } else if (min != null && max != null && max === min) {
    base = formatMoney(min);
  } else if (min != null) {
    base = `desde ${formatMoney(min)}`;
  } else if (svc.price > 0) {
    base = formatMoney(svc.price);
  } else if (note) {
    // Sin número pero con nota explicativa → solo la nota.
    return note;
  } else {
    return 'precio a consultar';
  }

  return `${base}${suffix}`;
}

/** Construye el link al minisite (NEXT_PUBLIC_APP_URL/{slug}). null si falta slug o appUrl. */
export function buildMinisiteUrl(
  business: LifestyleBusinessConfig,
  opts?: BusinessContextOptions,
): string | null {
  const base = (opts?.appUrl ?? '').replace(/\/+$/, '');
  if (!business.slug || !base) return null;
  return `${base}/${business.slug}`;
}

/** Formatea office_hours a líneas legibles ("Lunes: 09:00–18:00"). [] si no hay horarios. */
export function formatOfficeHours(officeHours: OfficeHours | null | undefined): string[] {
  if (!officeHours) return [];
  const lines: string[] = [];
  for (const key of DAY_ORDER) {
    const day = officeHours[key];
    if (day && day.start && day.end) {
      lines.push(`${DAY_NAMES[key]}: ${day.start}–${day.end}`);
    }
  }
  return lines;
}

/** Lista de atributos/amenities en true, traducidos a etiquetas legibles. */
const ATTRIBUTE_LABELS: Record<string, string> = {
  pays_cash:             'acepta pago en efectivo',
  pays_card:             'acepta pago con tarjeta',
  pays_transfer:         'acepta transferencia',
  parking:               'estacionamiento',
  kids_friendly:         'apto para niños',
  wifi:                  'wifi',
  wheelchair_accessible: 'acceso para silla de ruedas',
};

export function formatAttributes(attributes: Record<string, boolean> | null | undefined): string[] {
  if (!attributes) return [];
  return Object.entries(attributes)
    .filter(([, v]) => v === true)
    .map(([k]) => ATTRIBUTE_LABELS[k] ?? k);
}

// ─── Contexto estructurado ────────────────────────────────────────────────────

/**
 * Construye el bloque de contexto del negocio con datos REALES del tenant.
 * Determinista y testeable sin red. Se inyecta en el system prompt y en el
 * contexto del clasificador para responder side-questions con datos reales.
 */
export function buildBusinessContext(
  business: LifestyleBusinessConfig,
  services: ServiceRow[],
  opts?: BusinessContextOptions,
): string {
  const lines: string[] = [];

  const type = business.businessType?.trim() || 'negocio';
  lines.push(`Nombre: ${business.name}`);
  lines.push(`Tipo de negocio: ${type}`);

  if (business.address?.trim()) {
    lines.push(`Dirección: ${business.address}`);
  }
  if (business.mapUrl?.trim()) {
    lines.push(`Mapa: ${business.mapUrl}`);
  }

  const hours = formatOfficeHours(business.officeHours);
  if (hours.length > 0) {
    lines.push(`Horarios: ${hours.join(' | ')}`);
  }

  if (services.length > 0) {
    lines.push('Servicios:');
    for (const svc of services) {
      const desc = svc.description?.trim() ? ` — ${svc.description.trim()}` : '';
      lines.push(`- ${svc.name}: ${formatServicePrice(svc)}, ${svc.duration_minutes} min${desc}`);
    }
  }

  const amenities = formatAttributes(business.attributes);
  if (amenities.length > 0) {
    lines.push(`Comodidades: ${amenities.join(', ')}`);
  }

  if (business.reviewUrl?.trim()) {
    lines.push(`Reseñas: ${business.reviewUrl}`);
  }

  const minisite = buildMinisiteUrl(business, opts);
  if (minisite) {
    lines.push(`Sitio del negocio: ${minisite}`);
  }

  return lines.join('\n');
}

// ─── Respuesta determinista por topic (con fallback [DERIVA]) ─────────────────

/**
 * Devuelve una respuesta determinista para un side-question según su topic,
 * usando datos reales del negocio. Para topic 'other' o cuando falta el dato
 * → respuesta [DERIVA]: mensaje adecuado + link al minisite (si existe).
 *
 * No llama al LLM — es la base testeable y el fallback seguro de las respuestas.
 */
export function answerSideQuestion(
  topic: SideQuestionTopic,
  business: LifestyleBusinessConfig,
  services: ServiceRow[],
  opts?: BusinessContextOptions,
): string {
  switch (topic) {
    case 'price': {
      if (services.length === 0) return deriva(business, opts);
      const items = services.map((s) => `${s.name} ${formatServicePrice(s)}`);
      return `Estos son nuestros precios: ${items.join(', ')}.`;
    }
    case 'hours': {
      const hours = formatOfficeHours(business.officeHours);
      if (hours.length === 0) return deriva(business, opts);
      return `Nuestros horarios son: ${hours.join(', ')}.`;
    }
    case 'location': {
      if (!business.address?.trim()) return deriva(business, opts);
      const map = business.mapUrl?.trim() ? ` Aquí el mapa: ${business.mapUrl}` : '';
      return `Estamos en ${business.address}.${map}`;
    }
    case 'duration': {
      if (services.length === 0) return deriva(business, opts);
      const items = services.map((s) => `${s.name} ${s.duration_minutes} min`);
      return `Estas son las duraciones: ${items.join(', ')}.`;
    }
    case 'services': {
      if (services.length === 0) return deriva(business, opts);
      return `Ofrecemos: ${services.map((s) => s.name).join(', ')}.`;
    }
    case 'reviews': {
      if (!business.reviewUrl?.trim()) return deriva(business, opts);
      return `Nos ayudas un montón con tu reseña aquí: ${business.reviewUrl}`;
    }
    case 'other':
    default:
      return deriva(business, opts);
  }
}

/** Mensaje de derivación: link al minisite si existe, o derivación al equipo. */
function deriva(business: LifestyleBusinessConfig, opts?: BusinessContextOptions): string {
  const minisite = buildMinisiteUrl(business, opts);
  if (minisite) {
    return `Puedes ver todos los detalles en nuestro sitio: ${minisite}`;
  }
  return 'Con gusto lo consulto con el equipo y te confirmo.';
}
