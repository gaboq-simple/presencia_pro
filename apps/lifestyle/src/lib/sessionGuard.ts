// ─── Quién sigue adentro — la regla PURA de la sesión por PIN (S9-SEC-01) ─────
// Sin DB, sin red, sin React. Recibe lo que dice la cookie y lo que dice la fila
// de `staff` HOY, y decide si esa sesión sigue siendo válida.
//
// Existe porque hasta acá la identidad se armaba leyendo SOLO la cookie firmada
// (`lib/auth.ts`), y una cookie no sabe lo que pasó después de firmarse: que a esa
// persona la desactivaron, que le cambiaron el PIN, que ya no trabaja en ese
// negocio. Con 7 días de vigencia, "despedir a alguien" no lo sacaba del sistema.
//
// La regla, en una línea: **la cookie prueba quién dijo ser al entrar; la fila de
// `staff` decide si todavía puede.** Ante desacuerdo manda la fila, siempre.
//
// Por qué el rol se compara en vez de adoptarse: si la fila dice `admin` y la
// cookie dice `barber`, adoptar la fila ESCALARÍA una sesión viva sin que nadie
// vuelva a probar identidad — y el propio login por PIN rechaza a `admin`
// (`api/auth/pin/route.ts:145`). Un rol que cambió pide PIN de nuevo. Es la
// lectura conservadora, y es la única que no inventa permisos.
//
// El motivo del rechazo se devuelve con nombre en vez de un `null` pelado: quien
// llama lo registra, y "esta persona está desactivada" y "esta cookie es de otro
// negocio" son incidentes distintos aunque el efecto sea el mismo.

/** La fila de `staff` como está HOY. `null` = no existe (borrada, o id inventado). */
export type StaffVigente = {
  id:          string;
  business_id: string;
  role:        string;
  name:        string;
  active:      boolean;
};

/** Lo que la cookie afirma. Espejo mínimo de `SessionPayload`, sin el `exp` (que
 *  ya verificó `verifySession`) — este módulo decide vigencia de PERSONA, no de token. */
export type ReclamoDeCookie = {
  business_id: string;
  role:        string;
  /** `undefined` en la variante legada sin identidad (token compartido, retirada). */
  staff_id?:   string | undefined;
};

export type MotivoRechazo =
  /** La cookie no dice quién es: variante legada del token compartido. */
  | 'sin-identidad'
  /** El `staff_id` de la cookie ya no tiene fila. */
  | 'staff-inexistente'
  /** La fila existe pero es de otro negocio que el que dice la cookie. */
  | 'otro-negocio'
  /** La persona sigue en la tabla, desactivada. */
  | 'staff-inactivo'
  /** El rol de la fila ya no es el que la cookie afirma. */
  | 'rol-cambiado';

export type VeredictoSesion =
  | { ok: true;  staffId: string; businessId: string; role: string; name: string }
  | { ok: false; motivo: MotivoRechazo };

/**
 * ¿Esta cookie todavía habilita una sesión?
 *
 * El orden de los rechazos no es estético: va del más ciego al más específico,
 * para que el motivo registrado sea el que de verdad explica el caso. Una fila de
 * otro negocio se reporta como tal aunque además esté inactiva — el incidente que
 * importa ahí es el cruce de negocios.
 */
export function resolverSesionPin(
  reclamo: ReclamoDeCookie,
  staff: StaffVigente | null,
): VeredictoSesion {
  if (!reclamo.staff_id) return { ok: false, motivo: 'sin-identidad' };
  if (!staff || staff.id !== reclamo.staff_id) {
    return { ok: false, motivo: 'staff-inexistente' };
  }
  if (staff.business_id !== reclamo.business_id) {
    return { ok: false, motivo: 'otro-negocio' };
  }
  if (!staff.active) return { ok: false, motivo: 'staff-inactivo' };
  if (staff.role !== reclamo.role) return { ok: false, motivo: 'rol-cambiado' };

  return {
    ok:         true,
    staffId:    staff.id,
    businessId: staff.business_id,
    role:       staff.role,
    // El nombre sale de la FILA, no de la cookie: la cookie nunca lo llevó, y por
    // eso `app/staff/page.tsx` tenía que ir a buscarlo aparte en cada render.
    name:       staff.name,
  };
}
