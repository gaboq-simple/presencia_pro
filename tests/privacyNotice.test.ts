// ─── Tests del aviso de privacidad que manda el bot (S8-PER-01 · P0) ─────────
// Lo que fijan y por qué importa:
//   · el aviso vive en el dominio de la APP — el default anterior apuntaba a
//     zentriq.mx, que nunca existió: el bot llevaba meses mandándole a cada
//     cliente nuevo un link 404 justo en el mensaje donde le pide su
//     consentimiento;
//   · `PRIVACY_POLICY_URL` sigue mandando como override explícito;
//   · **sin dominio configurado NO se manda link** y se ofrece el correo. Un
//     enlace roto es peor que ninguno: le dice al titular que hay un aviso y le
//     cierra la puerta en la cara.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePrivacyUrl,
  buildPrivacyNotice,
  PRIVACY_CONTACT_EMAIL,
} from '../packages/engine/src/bot/lifestyle/copy';

const APP = 'https://lifestyle.presenciapro.com';

test('sin override, el aviso vive en el dominio de la APP', () => {
  assert.equal(
    resolvePrivacyUrl({ NEXT_PUBLIC_APP_URL: APP }),
    `${APP}/aviso-de-privacidad`,
  );
});

test('el override explícito gana', () => {
  assert.equal(
    resolvePrivacyUrl({ PRIVACY_POLICY_URL: 'https://otro.mx/privacidad', NEXT_PUBLIC_APP_URL: APP }),
    'https://otro.mx/privacidad',
  );
});

test('la barra final del dominio no duplica la barra de la ruta', () => {
  assert.equal(resolvePrivacyUrl({ NEXT_PUBLIC_APP_URL: `${APP}/` }), `${APP}/aviso-de-privacidad`);
  assert.equal(resolvePrivacyUrl({ NEXT_PUBLIC_APP_URL: `${APP}///` }), `${APP}/aviso-de-privacidad`);
});

test('sin dominio configurado NO hay URL — nunca una rota', () => {
  assert.equal(resolvePrivacyUrl({}), null);
  assert.equal(resolvePrivacyUrl({ NEXT_PUBLIC_APP_URL: '   ' }), null);
  assert.equal(resolvePrivacyUrl({ PRIVACY_POLICY_URL: '' , NEXT_PUBLIC_APP_URL: '' }), null);
});

test('el mensaje con dominio lleva el link en su propia línea', () => {
  const msg = buildPrivacyNotice({ NEXT_PUBLIC_APP_URL: APP });
  assert.ok(msg.includes(`\n${APP}/aviso-de-privacidad`));
  assert.ok(msg.startsWith('Al continuar, aceptas nuestro aviso de privacidad'));
});

test('el mensaje sin dominio ofrece el correo y no inventa una URL', () => {
  const msg = buildPrivacyNotice({});
  assert.ok(msg.includes(PRIVACY_CONTACT_EMAIL));
  assert.ok(!msg.includes('http'), `no debe haber URL: ${msg}`);
});

test('zentriq.mx ya no aparece por default en ningún caso', () => {
  for (const env of [{}, { NEXT_PUBLIC_APP_URL: APP }]) {
    assert.ok(!buildPrivacyNotice(env).includes('zentriq.mx/aviso'), 'quedó el default viejo');
  }
});
