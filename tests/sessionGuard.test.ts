// ─── Tests de la regla de vigencia de la sesión por PIN (S9-SEC-01) ───────────
// El candado que importa: una cookie válida y firmada NO alcanza. Si la persona
// dejó de estar activa, cambió de rol o de negocio, la sesión se cae — aunque le
// falten seis días de vigencia al token.
//
// Como en `envio.test.ts`, el candado trae su propia contraprueba: un doble que
// replica el defecto viejo (confiar solo en la cookie) y el test verifica que
// SERÍA detectado. Un test que no puede fallar no protege nada.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolverSesionPin,
  type StaffVigente,
  type ReclamoDeCookie,
} from '../apps/lifestyle/src/lib/sessionGuard';

const NEGOCIO = '4de6a450-9681-41b3-bdac-4b7fa39016a2';
const OTRO    = '00000000-0000-4000-8000-000000000999';
const CARLOS  = 'cd8d7f08-0250-47c5-b353-3c8dc6d72c24';

function cookie(over: Partial<ReclamoDeCookie> = {}): ReclamoDeCookie {
  return { business_id: NEGOCIO, role: 'barber', staff_id: CARLOS, ...over };
}

function fila(over: Partial<StaffVigente> = {}): StaffVigente {
  return { id: CARLOS, business_id: NEGOCIO, role: 'barber', name: 'Carlos', active: true, ...over };
}

// ─── El caso feliz ────────────────────────────────────────────────────────────

test('sesión vigente: cookie y fila coinciden → pasa, con el nombre de la FILA', () => {
  const v = resolverSesionPin(cookie(), fila());
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.staffId, CARLOS);
  assert.equal(v.ok && v.businessId, NEGOCIO);
  assert.equal(v.ok && v.role, 'barber');
  // El nombre nunca viajó en la cookie: si sale, salió de la fila.
  assert.equal(v.ok && v.name, 'Carlos');
});

// ─── Los cinco rechazos, cada uno con su motivo ───────────────────────────────

test('staff desactivado → se cae, aunque la cookie siga firmada y vigente', () => {
  const v = resolverSesionPin(cookie(), fila({ active: false }));
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.motivo, 'staff-inactivo');
});

test('staff borrado (sin fila) → se cae', () => {
  const v = resolverSesionPin(cookie(), null);
  assert.equal(!v.ok && v.motivo, 'staff-inexistente');
});

test('la fila es de otro negocio → se cae, y el motivo dice el cruce', () => {
  const v = resolverSesionPin(cookie(), fila({ business_id: OTRO }));
  assert.equal(!v.ok && v.motivo, 'otro-negocio');
});

test('el rol cambió → se cae: la sesión NO adopta el rol nuevo (no escala sola)', () => {
  const v = resolverSesionPin(cookie({ role: 'barber' }), fila({ role: 'admin' }));
  assert.equal(v.ok, false, 'una cookie de barbero no puede volverse admin sin re-login');
  assert.equal(!v.ok && v.motivo, 'rol-cambiado');
});

test('cookie sin staff_id (variante legada del token compartido) → no habilita nada', () => {
  const v = resolverSesionPin(cookie({ staff_id: undefined }), fila());
  assert.equal(!v.ok && v.motivo, 'sin-identidad');
});

test('el id de la fila no es el de la cookie → se cae (no se confía en el lookup)', () => {
  const v = resolverSesionPin(cookie(), fila({ id: OTRO }));
  assert.equal(!v.ok && v.motivo, 'staff-inexistente');
});

// ─── Precedencia del motivo ───────────────────────────────────────────────────

test('otro negocio manda sobre inactivo: el incidente que importa es el cruce', () => {
  const v = resolverSesionPin(cookie(), fila({ business_id: OTRO, active: false }));
  assert.equal(!v.ok && v.motivo, 'otro-negocio');
});

// ─── Contraprueba: el candado tiene que poder fallar ──────────────────────────

test('CONTRAPRUEBA — el defecto viejo (confiar solo en la cookie) sería detectado', () => {
  // Así se comportaba `getCurrentSession` antes de este paso: la cookie era la
  // única fuente, así que un barbero desactivado seguía adentro.
  const comoAntes = (c: ReclamoDeCookie) =>
    ({ ok: true as const, staffId: c.staff_id!, businessId: c.business_id, role: c.role, name: '' });

  const conElDefecto = comoAntes(cookie());
  const conElArreglo = resolverSesionPin(cookie(), fila({ active: false }));

  assert.equal(conElDefecto.ok, true, 'el doble tiene que reproducir el defecto');
  assert.notEqual(
    conElArreglo.ok,
    conElDefecto.ok,
    'si esto empata, el candado no está midiendo nada',
  );
});
