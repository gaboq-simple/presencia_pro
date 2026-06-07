// ─── Lifestyle Bot — Side-Question Router ([FIJO] / [DERIVA]) ──────────────────
// S4-BOT-07. Enrutador DETERMINISTA de side-questions con Haiku como respaldo.
//
// DECISIÓN DE ARQUITECTURA (ver SPRINT.md S4-BOT-07):
//   - Topic determinista + dato presente → PLANTILLA FIJA (cero LLM).
//   - Topic `other` / dato ausente / pregunta combinada → defer:
//     el caller usa el mecanismo Haiku existente (side_question_answer) o el
//     fallback [DERIVA] (link al minisite / derivación honesta).
//   - Banderas (pago/niños/estacionamiento) SIN dato → respuesta honesta
//     (NO minisite): el link no ayuda para un sí/no.
//
// REGLAS DE DISEÑO:
//   - 100% PURA y DETERMINISTA: NO consulta DB, NO lee process.env, NO toca red.
//     Todo entra por parámetros. El appUrl se pasa vía opts (igual que businessContext).
//   - Reutiliza buildMinisiteUrl/formatOfficeHours helpers de businessContext.
//   - Solo importa TIPOS → seguro de importar en tests sin SDKs.

import type { LifestyleBusinessConfig, ServiceRow, OfficeHours } from './types';
import { buildMinisiteUrl, type BusinessContextOptions } from './businessContext';

// ─── Topics ───────────────────────────────────────────────────────────────────

/** Topic base que emite classifyMultiIntent. */
export type BaseTopic = 'price' | 'hours' | 'location' | 'duration' | 'other';

/** Topic extendido derivado deterministamente del texto de la pregunta. */
export type ExtendedTopic =
  | BaseTopic
  | 'services' | 'payment' | 'kids' | 'parking' | 'reviews';

/** Resultado del router: respuesta determinista o señal de defer (Haiku/[DERIVA]). */
export type SideQuestionRoute =
  | { readonly mode: 'answer'; readonly text: string }
  | { readonly mode: 'defer' };

// ─── Constantes de texto ──────────────────────────────────────────────────────

/** Respuesta honesta para banderas sin dato cargado (decidido con el dueño). */
export const MISSING_DATA_ANSWER =
  'Sobre eso no tengo el dato a la mano, pero escríbenos y con gusto te confirmamos.';

// ─── Formas de pago (banderas en attributes) ──────────────────────────────────

const PAYMENT_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ['pays_cash', 'efectivo'],
  ['pays_card', 'tarjeta'],
  ['pays_transfer', 'transferencia'],
];

/** Lista de formas de pago habilitadas (true) en orden: efectivo, tarjeta, transferencia. */
export function paymentForms(attributes: Record<string, boolean> | null | undefined): string[] {
  if (!attributes) return [];
  return PAYMENT_FLAGS.filter(([key]) => attributes[key] === true).map(([, label]) => label);
}

// ─── Horarios en lenguaje natural (agrupando días con mismo horario) ──────────

const DAY_SINGULAR: Record<string, string> = {
  '1': 'lunes', '2': 'martes', '3': 'miércoles', '4': 'jueves',
  '5': 'viernes', '6': 'sábado', '0': 'domingo',
};
const DAY_PLURAL: Record<string, string> = {
  '1': 'lunes', '2': 'martes', '3': 'miércoles', '4': 'jueves',
  '5': 'viernes', '6': 'sábados', '0': 'domingos',
};
// Orden de la semana empezando en lunes (domingo al final).
const WEEK_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

type HourSegment = { days: string[]; start: string; end: string };

/**
 * Formatea office_hours a lenguaje natural agrupando días consecutivos con el
 * mismo horario. Días cerrados (null/ausentes) cortan los grupos y se omiten.
 * Ej: { Mon-Fri 10-20, Sat 10-18 } → "de lunes a viernes de 10:00 a 20:00, y sábados de 10:00 a 18:00".
 * Retorna '' si no hay horarios.
 */
export function formatOfficeHoursNatural(officeHours: OfficeHours | null | undefined): string {
  if (!officeHours) return '';

  const segments: HourSegment[] = [];
  for (const key of WEEK_ORDER) {
    const day = officeHours[key];
    if (day && day.start && day.end) {
      const last = segments[segments.length - 1];
      if (last && last.start === day.start && last.end === day.end) {
        last.days.push(key);
      } else {
        segments.push({ days: [key], start: day.start, end: day.end });
      }
    }
  }

  if (segments.length === 0) return '';

  const parts = segments.map((seg) => {
    const hours = `de ${seg.start} a ${seg.end}`;
    if (seg.days.length === 1) {
      return `${DAY_PLURAL[seg.days[0]!]} ${hours}`;
    }
    const first = DAY_SINGULAR[seg.days[0]!];
    const last = DAY_SINGULAR[seg.days[seg.days.length - 1]!];
    return `de ${first} a ${last} ${hours}`;
  });

  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')}, y ${parts[parts.length - 1]}`;
}

// ─── Precio (formato exacto para plantilla) ───────────────────────────────────

function formatExactPrice(price: number): string {
  return `$${price.toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
}

/** True si el servicio tiene precio en rango o con nota → delegar a Haiku. */
function hasRangeOrNote(svc: ServiceRow): boolean {
  return svc.price_min != null || svc.price_max != null || !!svc.price_note?.trim();
}

// ─── Refinamiento de topic (determinista, por keywords) ───────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const KW_PAYMENT = ['pago', 'pagar', 'pagos', 'tarjeta', 'efectivo', 'transferencia', 'transferir', 'deposito', 'terminal'];
const KW_KIDS    = ['nino', 'ninos', 'nina', 'ninas', 'infantil', 'hijo', 'hijos', 'bebe', 'bebes', 'peques'];
const KW_PARKING = ['estacionamiento', 'estacionar', 'parking', 'parqueo', 'aparcar', 'cochera', 'valet'];
const KW_REVIEWS = ['resena', 'resenas', 'opinion', 'opiniones', 'queja', 'quejas', 'reclamo', 'reclamar', 'calificar', 'calificacion', 'review', 'reviews', 'mala experiencia'];
const KW_SERVICES = ['servicio', 'servicios', 'ofrecen', 'ofreces', 'manejan', 'menu', 'catalogo'];
const KW_PRICE    = ['precio', 'precios', 'cuesta', 'cuestan', 'cuanto cuesta', 'cobran', 'cobra', 'vale', 'valen', 'costo', 'costos', 'tarifa', 'tarifas'];

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/**
 * True si la pregunta es sobre servicios o precio. Útil para decidir si es
 * pertinente anexar la lista/menú de servicios a la respuesta (S4-BOT-07 polish):
 * el menú solo aporta en preguntas de servicios/precio o al iniciar/retomar la
 * reserva, no en respuestas de ubicación/horario/pago/niños/estacionamiento/reseñas.
 */
export function isServiceOrPriceQuestion(question: string): boolean {
  const q = normalize(question);
  return hasKeyword(q, KW_SERVICES) || hasKeyword(q, KW_PRICE);
}

/**
 * Deriva el topic extendido a partir del topic base + texto de la pregunta.
 * Las categorías por bandera (payment/kids/parking) y reviews se detectan por
 * keyword sin importar el base topic (el clasificador no las emite). price/hours/
 * location/duration se confían tal cual; 'other' puede subir a 'services'.
 */
export function refineTopic(base: BaseTopic, question: string): ExtendedTopic {
  const q = normalize(question);
  if (hasKeyword(q, KW_PAYMENT)) return 'payment';
  if (hasKeyword(q, KW_KIDS))    return 'kids';
  if (hasKeyword(q, KW_PARKING)) return 'parking';
  if (hasKeyword(q, KW_REVIEWS)) return 'reviews';
  if (base === 'other') {
    if (hasKeyword(q, KW_SERVICES)) return 'services';
    return 'other';
  }
  return base;
}

// ─── Resolución del servicio objetivo (para precio/duración exactos) ──────────

/**
 * Identifica el servicio al que se refiere una pregunta de precio/duración.
 * Si hay un único servicio en el conjunto, ese. Si la pregunta menciona el
 * nombre (o primera palabra) de exactamente un servicio, ese. Si no → null.
 */
export function resolveTargetService(question: string, services: ServiceRow[]): ServiceRow | null {
  if (services.length === 1) return services[0]!;
  const q = normalize(question);
  const matches = services.filter((s) => {
    const name = normalize(s.name);
    if (q.includes(name)) return true;
    const firstWord = name.split(' ')[0] ?? '';
    return firstWord.length > 3 && q.includes(firstWord);
  });
  return matches.length === 1 ? matches[0]! : null;
}

// ─── Router principal ─────────────────────────────────────────────────────────

/**
 * Enruta una side-question a una respuesta determinista o a `defer`.
 * PURA — no llama al LLM. El caller maneja `defer` con Haiku o [DERIVA].
 */
export function routeSideQuestion(params: {
  topic: BaseTopic;
  question: string;
  business: LifestyleBusinessConfig;
  services: ServiceRow[];
  opts?: BusinessContextOptions;
  targetService?: ServiceRow | null;
}): SideQuestionRoute {
  const { topic, question, business, services, opts } = params;
  const ext = refineTopic(topic, question);

  switch (ext) {
    case 'location': {
      const address = business.address?.trim();
      if (!address) return { mode: 'defer' };
      const map = business.mapUrl?.trim();
      return {
        mode: 'answer',
        text: map
          ? `Estamos en ${address}. Aquí te dejo el mapa: ${map}`
          : `Estamos en ${address}.`,
      };
    }

    case 'hours': {
      const natural = formatOfficeHoursNatural(business.officeHours);
      if (!natural) return { mode: 'defer' };
      return { mode: 'answer', text: `Abrimos ${natural}.` };
    }

    case 'price': {
      const svc = params.targetService ?? resolveTargetService(question, services);
      if (!svc || hasRangeOrNote(svc) || svc.price <= 0) return { mode: 'defer' };
      return { mode: 'answer', text: `El ${svc.name} sale en ${formatExactPrice(svc.price)}.` };
    }

    case 'duration': {
      const svc = params.targetService ?? resolveTargetService(question, services);
      if (!svc) return { mode: 'defer' };
      return { mode: 'answer', text: `El ${svc.name} toma unos ${svc.duration_minutes} minutos.` };
    }

    case 'services': {
      if (services.length === 0) return { mode: 'defer' };
      return { mode: 'answer', text: `Manejamos: ${services.map((s) => s.name).join(', ')}.` };
    }

    case 'payment': {
      const attrs = business.attributes;
      const forms = paymentForms(attrs);
      if (forms.length > 0) return { mode: 'answer', text: `Aceptamos ${joinNatural(forms)}.` };
      // Sin formas en true: distinguir banderas presentes-en-false (negativa real)
      // de banderas ausentes (sin dato → honesta). NO colapsar ambos casos.
      const declined = PAYMENT_FLAGS
        .filter(([key]) => attrs?.[key] === false)
        .map(([, label]) => label);
      if (declined.length > 0) {
        return { mode: 'answer', text: `Por el momento no aceptamos ${joinNatural(declined)}.` };
      }
      return { mode: 'answer', text: MISSING_DATA_ANSWER };
    }

    case 'kids': {
      const v = readFlag(business.attributes, 'kids_friendly');
      if (v === null) return { mode: 'answer', text: MISSING_DATA_ANSWER };
      return { mode: 'answer', text: v ? 'Sí, atendemos niños.' : 'Por ahora solo atendemos adultos.' };
    }

    case 'parking': {
      const v = readFlag(business.attributes, 'parking');
      if (v === null) return { mode: 'answer', text: MISSING_DATA_ANSWER };
      return {
        mode: 'answer',
        text: v ? 'Sí, contamos con estacionamiento.' : 'No contamos con estacionamiento.',
      };
    }

    case 'reviews': {
      const reviewUrl = business.reviewUrl?.trim();
      if (reviewUrl) {
        return {
          mode: 'answer',
          text: `Lamento que no haya sido la mejor experiencia. Puedes dejarnos tu opinión aquí para que el equipo la vea: ${reviewUrl}`,
        };
      }
      const minisite = buildMinisiteUrl(business, opts);
      return {
        mode: 'answer',
        text: minisite
          ? `Lamento que no haya sido la mejor experiencia. Cuéntanos más aquí: ${minisite}`
          : 'Lamento que no haya sido la mejor experiencia. Escríbenos y con gusto lo revisamos con el equipo.',
      };
    }

    case 'other':
    default:
      return { mode: 'defer' };
  }
}

// ─── Fallback [DERIVA] (cuando Haiku no resuelve) ─────────────────────────────

/**
 * Respuesta [DERIVA] real: link al minisite si existe, o derivación honesta al
 * equipo. Es el último recurso cuando el topic no es determinista y Haiku no
 * produjo respuesta.
 */
export function derivaFallback(
  business: LifestyleBusinessConfig,
  opts?: BusinessContextOptions,
): string {
  const minisite = buildMinisiteUrl(business, opts);
  return minisite
    ? `Eso lo puedes ver aquí: ${minisite}`
    : 'Con gusto lo consultamos con el equipo y te confirmamos.';
}

/**
 * Conveniencia mid-flow: intenta una respuesta determinista (topic base 'other',
 * el refinamiento detecta banderas/servicios por keyword) y si no, deriva.
 * Usado cuando el clasificador detectó SIDE_QUESTION pero no produjo respuesta.
 */
export function answerSideQuestionDeterministic(
  question: string,
  business: LifestyleBusinessConfig,
  services: ServiceRow[],
  opts?: BusinessContextOptions,
): string {
  const route = routeSideQuestion({ topic: 'other', question, business, services, opts });
  return route.mode === 'answer' ? route.text : derivaFallback(business, opts);
}

// ─── Composición de respuesta en GREETING (GAP 1) ─────────────────────────────

/**
 * Compone la respuesta de GREETING cuando el primer mensaje es una side-question
 * pura: saludo breve + respuesta + invitación a agendar. Si la conversación ya
 * está en curso (hasHistory) responde directo sin re-saludar.
 */
export function composeGreetingSideAnswer(params: {
  answer: string;
  isReturning: boolean;
  customerName: string | null;
  botName: string;
  businessName: string;
  hasHistory: boolean;
}): string {
  const invite = '¿Te gustaría agendar una cita?';
  if (params.hasHistory) {
    return `${params.answer}\n${invite}`;
  }
  const greeting = params.isReturning && params.customerName
    ? `Hola ${params.customerName}.`
    : `Hola, soy ${params.botName} de ${params.businessName}.`;
  return `${greeting} ${params.answer}\n${invite}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lee una bandera booleana de attributes: true/false si existe, null si ausente. */
function readFlag(attributes: Record<string, boolean> | null | undefined, key: string): boolean | null {
  if (!attributes || !(key in attributes)) return null;
  return attributes[key] === true;
}

/** Une una lista con comas y "y" antes del último: [a,b,c] → "a, b y c". */
function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}
