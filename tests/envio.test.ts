// ─── tests/envio.test.ts — S9-OPS-08 ──────────────────────────────────────────
// Candado de la regla dura aplicada a `sent_at`: un mensaje que no salió NUNCA
// se registra como enviado. El molde es `tests/cobro.test.ts`, que hace lo mismo
// para el riel — incluido el test que rompe si alguien reintroduce el default.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRegistroEnvio,
  esEnvioRegistradoComoExitoso,
  ERROR_SIN_DETALLE,
  type RegistroEnvio,
} from '../apps/lifestyle/src/lib/envio';

const NOW = '2026-09-01T15:00:00.000Z';

describe('resolveRegistroEnvio — el desenlace se registra, no se supone', () => {
  // ── Los que importan: NINGÚN camino que no sea un éxito real escribe sent_at ──

  test('envío fallido NO escribe sent_at', () => {
    const r = resolveRegistroEnvio({ success: false, error: 'template not approved' }, NOW);
    assert.equal('sent_at' in r, false, 'un envío que falló jamás puede afirmar que salió');
    assert.deepEqual(r, {
      failed_at: NOW,
      metadata:  { error: 'template not approved' },
    });
  });

  test('envío no intentado (undefined) NO escribe sent_at — falta de intento no es éxito', () => {
    const r = resolveRegistroEnvio(undefined, NOW);
    assert.equal('sent_at' in r, false);
    assert.deepEqual(r, {
      failed_at: NOW,
      metadata:  { error: 'no se intentó el envío' },
    });
  });

  test('fallo sin motivo igual deja un motivo, nunca vacío', () => {
    for (const sinMotivo of [undefined, '', '   ']) {
      const r = resolveRegistroEnvio({ success: false, error: sinMotivo }, NOW);
      assert.deepEqual(r, { failed_at: NOW, metadata: { error: ERROR_SIN_DETALLE } });
    }
  });

  // ── Control positivo: el paso no sobre-bloquea ──────────────────────────────

  test('envío exitoso SÍ escribe sent_at, y solo sent_at', () => {
    const r = resolveRegistroEnvio({ success: true }, NOW);
    assert.deepEqual(r, { sent_at: NOW });
  });

  test('un éxito con `error` residual sigue siendo éxito (manda success)', () => {
    const r = resolveRegistroEnvio({ success: true, error: 'warning irrelevante' }, NOW);
    assert.deepEqual(r, { sent_at: NOW });
  });

  // ── La partición: uno u otro, nunca los dos, nunca ninguno ─────────────────
  // Una fila sin ninguno de los dos es indistinguible de una en cola, y eso es
  // exactamente lo que lee el despachador (`sent_at IS NULL AND failed_at IS NULL`).

  test('siempre exactamente UNA de las dos columnas', () => {
    const casos: Array<Parameters<typeof resolveRegistroEnvio>[0]> = [
      { success: true },
      { success: false },
      { success: false, error: 'x' },
      undefined,
    ];
    for (const caso of casos) {
      const r = resolveRegistroEnvio(caso, NOW) as Record<string, unknown>;
      const tiene = ['sent_at', 'failed_at'].filter((k) => k in r);
      assert.equal(tiene.length, 1, `esperaba exactamente una columna, hubo ${tiene.length}`);
    }
  });

  test('el instante se inyecta — el módulo no lee el reloj', () => {
    const otro = '2020-01-01T00:00:00.000Z';
    assert.deepEqual(resolveRegistroEnvio({ success: true }, otro), { sent_at: otro });
  });

  test('esEnvioRegistradoComoExitoso lee la forma sin que el llamador se equivoque', () => {
    assert.equal(esEnvioRegistradoComoExitoso({ sent_at: NOW }), true);
    const fallo: RegistroEnvio = { failed_at: NOW, metadata: { error: 'x' } };
    assert.equal(esEnvioRegistradoComoExitoso(fallo), false);
  });
});

describe('contraprueba del propio candado', () => {
  // Si `resolveRegistroEnvio` fuera reemplazada por algo que siempre devuelve
  // `{sent_at}` —que es EXACTAMENTE el defecto que este paso borró— los tests de
  // arriba tienen que romperse. Se verifica acá con un doble, para que el candado
  // no pase por vacuidad: un test que no puede fallar no protege nada.
  const defectoViejo = (_e: unknown, nowIso: string) => ({ sent_at: nowIso });

  test('el defecto viejo (sent_at incondicional) sería detectado', () => {
    const r = defectoViejo({ success: false, error: 'rechazado' }, NOW) as Record<string, unknown>;
    assert.equal('sent_at' in r, true, 'así se comportaba antes');
    assert.notDeepEqual(
      r,
      resolveRegistroEnvio({ success: false, error: 'rechazado' }, NOW),
      'si esto fuera igual, el paso no cambió nada',
    );
  });
});
