# Guía de estilo del bot (AUD-06)

Convención ÚNICA para todo texto que llega al cliente por WhatsApp — tanto las
plantillas deterministas (strings en `states/*`, `clarification.ts`,
`sideQuestion.ts`, `businessContext.ts`, `router.ts`) como el texto generado
por LLM (gobernado por `FORMATTING_RULES` en `prompt.ts`, que referencia esta
guía). Antes convivían dos voces (plantillas sin acentos ni "¿" vs LLM con
ortografía completa) y el cliente las recibía mezcladas en una misma
conversación.

## Voz

- Español de México, tuteo, cálido pero directo. Como un asistente real por
  WhatsApp, no un formulario. Nada de voseo ("preferís") ni giros de otras
  regiones.
- Un pensamiento por mensaje; máximo UNA pregunta por mensaje.
- Mensajes cortos (≤3 líneas). Única excepción: el resumen de confirmación de
  cita, que lleva sus datos completos.
- Nunca prometer una acción que el turno no ejecuta ("Buscando otra opción...")
  — el mensaje siempre cierra con la pelota del lado del cliente ("¿Te busco
  con otro barbero?").

## Ortografía y puntuación

- Español correcto SIEMPRE: acentos ("día", "duración", "mañana") y signos de
  apertura y cierre ("¿Cuál prefieres?", "¡Te esperamos!").
- Horas en lenguaje natural: "5 de la tarde", "1:30 de la tarde". Nunca AM/PM
  ni formato 24h.
- Fechas a media frase en minúsculas: "el miércoles 22 de julio". Los arrays
  canónicos `DAYS_ES`/`MONTHS_ES` viven en `copy.ts` (minúsculas, acentuados);
  capitalizar en el punto de uso si el contexto lo pide.

## Formato WhatsApp

- Texto plano: sin markdown, sin asteriscos.
- Links SIEMPRE en su propia línea (salto de línea antes y después), nunca
  embebidos a media frase.
- Listas de opciones con números ("1. Corte de cabello"), una opción por
  línea. Nunca listas con guiones. Nunca 3+ opciones en párrafo corrido.

## Emojis

- Por defecto, ninguno en las plantillas deterministas.
- Si se usan: solo en momentos POSITIVOS (confirmación de cita) y máximo uno.
- Nunca en momentos de fricción (escalamiento, errores, clarificaciones) —
  un 🙏 tras tres fallos se lee como burla.

## Fuente única de copy repetido

- Cualquier mensaje o vocabulario que aparezca en 2+ archivos vive en
  `copy.ts` (mensajes de escalamiento/error, `DAYS_ES`/`MONTHS_ES`,
  keywords afirmativos/negativos base, respuesta de precio/duración).
- Las listas afirmativas/negativas de cada estado se componen como
  `[...AFFIRMATIVE_BASE_KEYWORDS, ...extrasDelContexto]` — la base nunca se
  recorta: "va" debe funcionar igual al confirmar el horario, el nombre o la
  lista de espera.

## Al agregar copy nuevo

1. ¿Ya existe un mensaje equivalente? Ir a `copy.ts` antes de escribir otro.
2. Ortografía completa + las reglas de arriba.
3. Si el mensaje hace una pregunta, verificar que el estado sepa entender la
   respuesta natural a ESA pregunta (principio: "presentación natural exige
   comprensión natural").
