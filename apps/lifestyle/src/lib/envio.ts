// ─── envio — qué se escribe cuando se intenta mandar un mensaje (S9-OPS-08) ───
//
// Módulo PURO, molde de `lib/cobro.ts`: la regla de qué columna se escribe vive
// en un solo lugar y con su test-candado, en vez de repetida en cada llamador.
//
// El problema que cierra. Las funciones de `whatsapp-templates.ts` **nunca
// lanzan** —lo dice su propio encabezado (`:65`) y devuelven `TemplateSendResult`—
// así que un `await send…(…)` pelado se traga cualquier rechazo de Meta y el
// código sigue como si el mensaje hubiera salido. Escribir `sent_at` después de
// ese await es fabricar la evidencia con la que la auditoría responde más tarde.
//
// La regla dura de `CLAUDE.md`: ningún campo que afirme un hecho del mundo se
// escribe sin evidencia de ese hecho. `sent_at` afirma que un mensaje SALIÓ.
// Los tres campos de la terna: `arrived_at` lo cerró S9-OPS-03, `payment_method`
// (el riel) lo cerró S9-OPS-06, y `sent_at` es este paso.
//
// Uno u OTRO, nunca los dos y nunca ninguno — una fila sin `sent_at` ni
// `failed_at` es indistinguible de una que todavía está en cola, y esa
// ambigüedad es lo que el despachador lee (`sent_at IS NULL AND failed_at IS NULL`).

/** Lo que devuelven las funciones de envío. Estructural a propósito: acepta
 *  `TemplateSendResult` y el resultado de `sendWhatsAppMeta` sin acoplarse a
 *  ninguno de los dos. */
export type ResultadoEnvio = {
  success: boolean;
  error?:  string | undefined;
};

/** Las columnas de `scheduled_notifications` que registran el desenlace. */
export type RegistroEnvio =
  | { sent_at: string }
  | { failed_at: string; metadata: { error: string } };

/** Texto cuando el envío falló sin decir por qué. Un `failed_at` sin motivo
 *  sigue siendo mejor que un `sent_at` falso, pero el motivo es lo que hace
 *  accionable la fila — por eso nunca queda vacío. */
export const ERROR_SIN_DETALLE = 'error sin detalle';

/**
 * Traduce el resultado de un intento de envío a las columnas que lo registran.
 *
 * @param envio  Lo que devolvió la función de envío. `undefined` = no se llegó
 *               a intentar (falta configuración, credenciales, etc.), que **no**
 *               es un envío exitoso: cuenta como fallo con su motivo.
 * @param nowIso Instante del registro, inyectado por el llamador (el módulo es
 *               puro: no lee el reloj).
 */
export function resolveRegistroEnvio(
  envio:  ResultadoEnvio | undefined,
  nowIso: string,
  motivoSiNoSeIntento = 'no se intentó el envío',
): RegistroEnvio {
  if (!envio) {
    return { failed_at: nowIso, metadata: { error: motivoSiNoSeIntento } };
  }
  if (envio.success) {
    return { sent_at: nowIso };
  }
  return {
    failed_at: nowIso,
    metadata:  { error: envio.error?.trim() ? envio.error : ERROR_SIN_DETALLE },
  };
}

/** `true` si el registro afirma que el mensaje salió. Para que un llamador no
 *  tenga que inspeccionar la forma del objeto (ni equivocarse al hacerlo). */
export function esEnvioRegistradoComoExitoso(registro: RegistroEnvio): boolean {
  return 'sent_at' in registro;
}
