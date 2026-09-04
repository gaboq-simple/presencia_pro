// ─── La regla de supresión del despachador (S7-NOTIF-01) ──────────────────────
// PURO a propósito: sin `Deno`, sin red, sin imports. Vive dentro de la carpeta
// de la function para que el bundle la incluya, y **la suite de node lo importa
// por ruta relativa**, así que la regla que se despliega es exactamente la que
// los tests fijan. Sin esto, la única copia de la regla en Deno no tendría cómo
// probarse.
//
// Por qué existe: esta function tiene su PROPIA copia de `sendWhatsAppMeta`
// —Deno no comparte el paquete del engine—, así que el guard de la baja que
// S8-PER-01 · P3 puso en el engine NO la cubre. Mientras la function no estaba
// desplegada eso no hacía daño; el día que se despliegue, sí.
//
// La regla es la MISMA que `apps/lifestyle/src/lib/optOutLookup.ts`, y que sean
// dos copias es una deuda declarada, no un descuido: el candado
// `tests/supresionDespachador.test.ts` compara las dos y rompe si se separan.

/** Los dos tipos PROACTIVOS de los nueve que despacha. */
export const TIPOS_PROACTIVOS: readonly string[] = ['review_request', 'reactivation'];

/**
 * Los otros siete son `appointment_utility`: NO se suprimen. Son de una cita que
 * el propio cliente agendó, y no dárselos es peor servicio, no más privacidad
 * (regla de niveles, `docs/planes/permiso.md`).
 */
export function esProactivo(tipo: string): boolean {
  return TIPOS_PROACTIVOS.includes(tipo);
}

export type FilaDeCliente = {
  opted_out_at:  string | null;
  consent_at:    string | null;
  consented_via: string | null;
};

/**
 * Por qué NO se le puede escribir a esta persona, o `null` si sí se puede.
 *
 * Bloquea dos cosas, no una — la baja y la ausencia de consentimiento:
 *   · `opted_out_at` — el titular pidió la baja (P2).
 *   · `consent_at IS NULL` o `consented_via = 'pending_notice'` — nunca vio el
 *     aviso (P4). Si solo mirara la baja, el agujero se mudaría de lugar.
 *
 * **Un teléfono sin fila NO está dado de baja** (`fila === null` → `null`): todo
 * lo proactivo sale de `customers`, así que un número sin fila no puede recibir
 * nada de todos modos, y bloquearlo frenaría altas recién creadas.
 */
export function motivoDeSupresion(fila: FilaDeCliente | null): string | null {
  if (!fila) return null;
  if (fila.opted_out_at !== null) return 'el titular se dio de baja';
  if (fila.consent_at === null || fila.consented_via === 'pending_notice') {
    return 'el titular todavía no vio el aviso de privacidad';
  }
  return null;
}

/**
 * Qué hacer con una fila de la cola, ya sabiendo el tipo y (si hizo falta) el
 * cliente. `error` = la consulta de bajas falló.
 *
 * **Falla CERRADO**: si no se pudo comprobar, se suprime. Es la única dirección
 * segura — mandarle a alguien que quizá se dio de baja es el daño que el guard
 * viene a evitar; no mandarle a alguien que no se dio de baja se arregla con el
 * siguiente intento. Mismo criterio que el guard del engine.
 */
export function decidirEnvio(
  tipo: string,
  fila: FilaDeCliente | null,
  error?: boolean,
): { enviar: true } | { enviar: false; motivo: string } {
  if (!esProactivo(tipo)) return { enviar: true };
  if (error) return { enviar: false, motivo: 'no se pudo comprobar la baja' };

  const motivo = motivoDeSupresion(fila);
  return motivo === null ? { enviar: true } : { enviar: false, motivo };
}
