// ─── Intérprete de turno único (R2, Pieza A) ─────────────────────────────────
// Capa que interpreta el mensaje del usuario UNA sola vez por turno y produce un
// objeto `Interpretation` inmutable. CRUDO y NEUTRAL: detecta señales ("hay una
// hora=19:00", "hay afirmación", "hay mención de barbero") pero NO decide
// política de estado (¿"va" cuenta como sí aquí? ¿una hora sin día es válida?).
// Esa resolución la hace cada estado leyendo de aquí (guardarraíl B2).
//
// 100% DETERMINISTA. CERO llamadas LLM (guardarraíl B1). El classifier LLM sigue
// donde está hoy, detrás del fast-path de cada estado; este módulo consolida los
// DETECTORES DETERMINISTAS, no la clasificación.
//
// Fuente de verdad de los parsers: `extractRawTime`/`resolveTargetMinutes` (el
// parser superior, promovido desde confirmingAppointment.ts) y `parseDate` (de
// qualifyingDatetime.ts, sólido y TZ-correcto). En R2 NADIE consume todavía
// `Interpretation` (eso es Pieza B/C) — Pieza A solo agrega el módulo + tests.

import { parseDate } from './states/qualifyingDatetime';

// ─── Normalización (movida desde confirmingAppointment.ts, sin cambio) ────────

// Normaliza para matchear: minúsculas + NFD + strip de diacríticos (mismo
// patrón que sideQuestion.ts). Trabajamos con listas ASCII puras para evitar
// el bug de acento ("sí" no matcheaba con \b) y NO usamos \b (su boundary
// falla antes de caracteres acentuados / es la fuente del bug).
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Limpia para comparar mensaje completo: normaliza, quita puntuación y colapsa
// espacios. Permite el match exacto de tokens cortos.
export function cleanMessage(body: string): string {
  return normalize(body).replace(/[¿?¡!.,;:]/g, '').replace(/\s+/g, ' ').trim();
}

// ─── Afirmación / negación (movidas desde confirmingAppointment.ts) ───────────
// Listas únicas: el intérprete y confirmingAppointment leen de aquí (no hay una
// séptima lista paralela; se consolidó la fuente de verdad).

// Afirmaciones para aceptar el slot cercano ofrecido (decisión b, follow-up).
// Tokens cortos/ambiguos → SOLO match de mensaje completo (evita aceptar
// "¿va a estar?" por contener "va"). Para "si" además evita tragarse
// "si, a las 6" (eso es una corrección, la consume el router downstream).
export const AFFIRM_FULL = ['si', 'va', 'ok', 'okay', 'sale', 'vale'];
// Afirmaciones largas/distintivas → anclaje por espacios (no substring crudo).
export const AFFIRM_ANCHORED = [
  'simon', 'dale', 'claro', 'perfecto', 'correcto', 'afirmativo',
  'de acuerdo', 'me sirve', 'orale',
];

export function isAffirmation(body: string): boolean {
  const n = cleanMessage(body);
  if (AFFIRM_FULL.includes(n)) return true;
  const padded = ` ${n} `;
  return AFFIRM_ANCHORED.some((k) => padded.includes(` ${k} `));
}

// Negaciones claras. Cortas/ambiguas → match de mensaje completo. La distintiva
// "negativo" → anclaje por espacios. Las negaciones IMPLÍCITAS ("que amable",
// "a la vuelta", "luego", "asi esta bien gracias") NO se fuerzan aquí: caen al
// clarify natural. Esta detección corre SOLO downstream del router (cuando
// devuelve 'none'); las correcciones tipo "no, a las 6" ya las consumió el
// matcher natural antes de llegar aquí.
export const NEGATION_FULL = ['no', 'nel', 'ahorita no', 'no gracias'];
export const NEGATION_ANCHORED = ['negativo'];

export function isNegation(body: string): boolean {
  const n = cleanMessage(body);
  if (NEGATION_FULL.includes(n)) return true;
  const padded = ` ${n} `;
  return NEGATION_ANCHORED.some((k) => padded.includes(` ${k} `));
}

// ─── No-preferencia de barbero/slot (R4.2) ────────────────────────────────────
// Lista ÚNICA de keywords de no-preferencia, consumida por qualifyingStaff y
// confirmingAppointment (antes cada estado tenía su PROPIA copia, ya divergidas:
// confirming reconocía 'no tengo tema'/'el que este' que staff no). Esta es la
// fuente de verdad; cierra esa duplicación.
//
// Detección CRUDA y NEUTRAL: solo presencia de keyword (guardarraíl B2). La
// POLÍTICA sensible al estado NO vive aquí: en confirmingAppointment "cualquiera
// de la tarde" NO es no-preferencia sino preferencia de turno (hay slots
// mostrados), y ese guard (SHIFT_OR_EXTREME) se queda en ese estado. El intérprete
// entiende neutral; cada estado aplica su política.
//
// Saneada (S5-BOT-04): SIN 'disponible'/'libre' sueltos — eran falsos positivos
// por substring ("¿qué barbero está disponible?" NO es no-preferencia). 'cualquier'
// cubre "cualquiera"/"cualquier barbero"; 'el que este' cubre "el que este
// disponible"; 'da igual' cubre "me da igual".
export const NO_PREFERENCE_KEYWORDS = [
  'cualquier', 'el que sea', 'quien sea', 'no importa', 'no me importa',
  'da igual', 'no tengo preferencia', 'no tengo tema', 'el que este',
];

// Presencia cruda de keyword de no-preferencia sobre el texto normalizado (sin
// diacríticos). NO aplica el guard de turno/extremo (eso es política de estado).
export function detectNoPreference(norm: string): boolean {
  return NO_PREFERENCE_KEYWORDS.some((kw) => norm.includes(kw));
}

// ─── Números en palabras → dígito (Hallazgo 3) ────────────────────────────────
// FUENTE ÚNICA palabra→dígito para los parsers deterministas. El bug: el cliente
// dice "once" / "a las nueve" y el parser (100% \d) no lo reconoce. greeting y
// qualifyingDatetime lo disimulan (avanzan por otras señales y listan el día);
// el browse, estricto, lo rechaza con "no te seguí bien". Esta capa convierte el
// número-palabra a su dígito para que los regex \d EXISTENTES de extractRawTime /
// detectBareDigit / routeSlotSelection lo reconozcan sin duplicar lógica — cura
// la divergencia DE RAÍZ y mantiene el FSM 100% determinista (cero LLM).
//
// Dos accesos sobre el MISMO mapa `HOUR_WORD`:
//  - `digitizeNumberWords` (CON marcador): reemplaza "las once" / "once y media" /
//    "ocho de la tarde" → dígito. El marcador desambigua, así que aquí "una" SÍ
//    se convierte ("la una"→"la 1", "una y media"→"1 y media").
//  - `wordToHour` (token PELADO): "once"→11, "tres"→3, pero "una"/"un"→null
//    (tienen forma de artículo: "una cita" NO es la hora 1). Sin marcador sólo se
//    aceptan palabras-número sin colisión.
const HOUR_WORD: Record<string, number> = {
  una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23,
};

// Tokens con forma de artículo: como número PELADO NO cuentan como hora (protege
// "una cita"). Con marcador explícito sí (lo resuelve digitizeNumberWords).
const BARE_BLOCKED = new Set(['una', 'un']);

// Alternación de palabras-número, las más LARGAS primero (evita que "uno" gane
// sobre "veintiuno", o "veinte" sobre "veintitres", al construir el regex).
const WORD_ALT = Object.keys(HOUR_WORD).sort((a, b) => b.length - a.length).join('|');

// Marcadores que, tras un número-palabra, PRUEBAN que es una hora ("nueve y media",
// "ocho de la tarde", "siete pm"). Sin acentos: digitizeNumberWords normaliza antes.
const TIME_SUFFIX =
  '(?:y\\s+(?:media|cuarto)|en\\s+punto|(?:de|por|en)\\s+la\\s+(?:manana|tarde|noche)|a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)';

/**
 * Token PELADO → hora (1..23), o null. "once"→11, "tres"→3; "una"/"un"→null
 * (artículo). Lo usan los sitios de número desnudo (detectBareDigit y el step-4
 * del browse), que ya tratan un dígito suelto como hora-o-índice.
 */
export function wordToHour(token: string): number | null {
  const t = normalize(token).trim();
  if (BARE_BLOCKED.has(t)) return null;
  return HOUR_WORD[t] ?? null;
}

/**
 * Reemplaza números-palabra por su dígito SOLO en contexto de hora (con marcador),
 * para que los regex \d de extractRawTime los reconozcan. Devuelve el texto
 * normalizado (minúsculas, sin diacríticos) con las sustituciones aplicadas.
 */
export function digitizeNumberWords(text: string): string {
  let t = normalize(text);
  // (a) Precedido por "las"/"la"/"a las"/"a la": "a las once"→"a las 11",
  //     "la una"→"la 1". El marcador desambigua → "una" SÍ se convierte aquí.
  t = t.replace(
    new RegExp(`\\b(a\\s+)?(las?)\\s+(${WORD_ALT})\\b`, 'g'),
    (_m, a, las, w) => `${a ?? ''}${las} ${HOUR_WORD[w]}`,
  );
  // (b) Seguido por marcador de minuto/turno/período: "once y media"→"11 y media",
  //     "ocho de la tarde"→"8 de la tarde". El lookahead conserva el marcador.
  t = t.replace(
    new RegExp(`\\b(${WORD_ALT})\\s+(?=${TIME_SUFFIX})`, 'g'),
    (_m, w) => `${HOUR_WORD[w]} `,
  );
  return t;
}

// ─── Parser de hora (movido desde confirmingAppointment.ts) ───────────────────

export type RawTime = { hour: number; minute: number; explicitPeriod: 'am' | 'pm' | null };

/**
 * Parser de hora. Solo devuelve hora cuando hay un MARCADOR de hora
 * ("a las"/"las"/":MM"/pm/am/"de la tarde"/"y media"/"mediodía"). Un número
 * desnudo —dígito "5" o palabra "once"— NO es hora aquí → se trata como índice
 * (decisión e); los sitios de número desnudo usan `wordToHour`.
 *
 * Reconoce números en palabras vía `digitizeNumberWords` (Hallazgo 3): "a las
 * once"→11:00, "nueve y media"→09:30, "mediodía"→12:00.
 */
export function extractRawTime(lowerRaw: string): RawTime | null {
  // Normaliza y convierte números-palabra en contexto → los regex \d de abajo
  // operan idéntico sobre dígitos y palabras (fuente única, sin ramas paralelas).
  const lower = digitizeNumberWords(lowerRaw);

  // El marcador pm/am puede venir PEGADO al dígito ("5pm", "5am", "5p.m."). El
  // boundary \b falla entre dígito y "p"/"a" (ambos word-chars), así que el
  // límite izquierdo es un lookbehind negativo de LETRA: admite dígito / espacio
  // / inicio antes del marcador, pero NO una letra (evita matchear "pm"/"am"
  // embebidos en palabras como "examen"). El \b derecho se conserva.
  const pm = /(?<![a-z])(pm|p\.?\s?m\.?)\b/.test(lower) || /(de|por|en)\s+la\s+(tarde|noche)/.test(lower);
  const am = /(?<![a-z])(am|a\.?\s?m\.?)\b/.test(lower) || /(de|por|en)\s+la\s+(manana)/.test(lower);

  // Minuto explícito por frase ("y media"→30, "y cuarto"→15, "en punto"→0). Actúa
  // también como marcador de hora para "once y media" (ver patrón 3b).
  let minutePhrase: number | null = null;
  if (/\by\s+media\b/.test(lower))       minutePhrase = 30;
  else if (/\by\s+cuarto\b/.test(lower)) minutePhrase = 15;
  else if (/\ben\s+punto\b/.test(lower)) minutePhrase = 0;

  // "mediodía" → 12:00 (período del día; no lleva marcador "las").
  if (/\bmediodia\b/.test(lower)) {
    return { hour: 12, minute: minutePhrase ?? 0, explicitPeriod: null };
  }

  let hour:    number | null = null;
  let minute = 0;

  // 1. "HH:MM"
  let m = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    hour   = parseInt(m[1]!, 10);
    minute = parseInt(m[2]!, 10);
  } else {
    // 2. "5pm" / "5 pm" / "5am"
    m = lower.match(/\b(\d{1,2})\s*(?:pm|p\.?\s?m\.?|am|a\.?\s?m\.?)\b/);
    if (m) {
      hour = parseInt(m[1]!, 10);
    } else {
      // 3. "a las 5" / "a la 1" / "las 5" / "el de las 5"
      m = lower.match(/\b(?:a\s+)?las?\s+(\d{1,2})\b/);
      if (m) {
        hour = parseInt(m[1]!, 10);
      } else {
        // 3b. "5 y media" / "5 y cuarto" / "5 en punto": la frase de minuto ACTÚA
        //     como marcador de hora (igual que "las") → habilita "once y media".
        m = lower.match(/\b(\d{1,2})\s+(?:y\s+(?:media|cuarto)|en\s+punto)\b/);
        if (m) {
          hour = parseInt(m[1]!, 10);
        } else if (pm || am) {
          // 4. número suelto con marcador de turno ("5 de la tarde")
          m = lower.match(/\b(\d{1,2})\b/);
          if (m) hour = parseInt(m[1]!, 10);
        }
      }
    }
  }

  if (hour === null) return null;

  // La frase de minuto aplica salvo que "HH:MM" ya haya fijado minutos explícitos.
  if (minute === 0 && minutePhrase !== null) minute = minutePhrase;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute, explicitPeriod: pm ? 'pm' : am ? 'am' : null };
}

/**
 * Desambigua AM/PM contra los slots reales (decisión f): si "5" es ambiguo,
 * elige la interpretación (5 AM / 5 PM) cuyo slot más cercano esté más cerca.
 * NO usa heurística fija "1-6 → PM".
 *
 * NOTA (guardarraíl B2): necesita `slotMins` (contexto de estado), por lo que es
 * POLÍTICA DE ESTADO. `interpret()` NO la llama — la siguen llamando los estados
 * con sus propios slots. Vive aquí solo para consolidar el parser en un módulo.
 */
export function resolveTargetMinutes(raw: RawTime, slotMins: number[]): number {
  let h = raw.hour;
  let candidates: number[];

  if (raw.explicitPeriod === 'pm') {
    if (h < 12) h += 12;
    candidates = [h];
  } else if (raw.explicitPeriod === 'am') {
    if (h === 12) h = 0;
    candidates = [h];
  } else if (h === 0 || h >= 13 || h === 12) {
    candidates = [h];
  } else {
    candidates = [h, h + 12]; // 1..11 → ambiguo
  }

  let best  = candidates[0]!;
  let bestD = Infinity;
  for (const c of candidates) {
    const t = c * 60 + raw.minute;
    let d = Infinity;
    for (const sm of slotMins) d = Math.min(d, Math.abs(sm - t));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best * 60 + raw.minute;
}

// ─── Detectores neutros adicionales ───────────────────────────────────────────

// Ordinales explícitos → índice 0-based. "el último" se OMITE a propósito: su
// resolución exige conocer la cantidad de opciones (contexto de estado, B2), así
// que el intérprete neutro lo deja en null y el estado lo resuelve.
function detectOrdinal(norm: string): number | null {
  if (/primer/.test(norm))  return 0;
  if (/segund/.test(norm))  return 1;
  if (/tercer/.test(norm))  return 2;
  if (/cuart/.test(norm))   return 3;
  if (/quint/.test(norm))   return 4;
  return null;
}

// Mención CRUDA de barbero: "con <token>". Heurística textual neutra — NO se
// resuelve contra la lista real de staff (eso es política de estado). Devuelve el
// token tal cual (puede ser un falso positivo como "con gusto"; el estado filtra).
function detectStaffMention(norm: string): string | null {
  const m = norm.match(/\bcon\s+([a-zñ]+)/);
  return m ? m[1]! : null;
}

// Dígito desnudo (índice potencial): un número 1–2 dígitos que NO es una hora.
// Solo se computa cuando NO hay hora detectada (un "10:15" o "a las 5" no cuenta).
// Acepta también el número-palabra como mensaje pelado ("once"→11) vía wordToHour
// (misma fuente que el browse); "una"/"un" sueltos → null (artículo).
function detectBareDigit(lower: string): number | null {
  const m = lower.match(/\b(\d{1,2})\b/);
  if (m) return parseInt(m[1]!, 10);
  return wordToHour(lower);
}

// ─── Tipo público e intérprete ────────────────────────────────────────────────

// Interpretación CRUDA y NEUTRAL del turno. No decide política de estado.
export type Interpretation = {
  readonly raw: string;              // mensaje normalizado (minúsculas, sin diacríticos)
  readonly time:   { hour: number; minute: number; period: 'am' | 'pm' | null } | null;
  readonly date:   string | null;    // YYYY-MM-DD (vía parseDate), o null
  readonly affirmation: boolean | null;  // sí=true / no=false / no aplica=null
  readonly noPreference: boolean;         // "cualquiera"/"el que sea"/… (CRUDO: sin guard de turno)
  readonly staffMention: string | null;  // nombre de barbero crudo, o null
  readonly hasSideQuestion: boolean;      // contiene "?" / "¿"
  readonly ordinal: number | null;        // "la primera"→0, etc. (0-based)
  readonly bareDigit: number | null;      // dígito desnudo (índice potencial)
};

export function interpret(input: {
  message: string;
  now: Date;
  timezone: string;
}): Interpretation {
  const { message, now, timezone } = input;

  // `lower` conserva acentos (parseDate compara "mañana" con ñ; extractRawTime
  // acepta ambas variantes). `norm` los quita para los detectores ASCII puros.
  const lower = message.toLowerCase();
  const norm  = normalize(message);

  const raw = extractRawTime(lower);
  const time = raw
    ? { hour: raw.hour, minute: raw.minute, period: raw.explicitPeriod }
    : null;

  const date = parseDate(lower, now, timezone);

  const affirmation = isAffirmation(message)
    ? true
    : isNegation(message)
      ? false
      : null;

  const noPreference   = detectNoPreference(norm);
  const staffMention   = detectStaffMention(norm);
  const hasSideQuestion = /[?¿]/.test(message);
  const ordinal        = detectOrdinal(norm);
  // Un dígito que sí es hora ("10:15", "a las 5") NO es un índice desnudo.
  const bareDigit      = time === null ? detectBareDigit(lower) : null;

  return {
    raw: norm,
    time,
    date,
    affirmation,
    noPreference,
    staffMention,
    hasSideQuestion,
    ordinal,
    bareDigit,
  };
}
