// S4-BOT-04 — Retrocompatibilidad del schema de onboarding.
// Verifica que configs viejas (sin los campos nuevos) siguen validando y que
// las nuevas (review_url, map_url, attributes, price_min/max/note) son aceptadas.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConfigSchema } from '../apps/lifestyle/scripts/onboard-schema';

const baseConfig = {
  business: {
    name: 'Barbería El Corte',
    slug: 'barberia-el-corte',
    business_type: 'barbería',
    address: 'Av. Reforma 123, CDMX',
    timezone: 'America/Mexico_City',
  },
  bot: {
    assistant_name: 'Zlot',
    greeting: 'Hola',
    fallback_message: 'No entendí.',
    away_message: 'Cerrado.',
  },
  staff: [{ name: 'Juan', role: 'barber' as const }],
  services: [
    { id: 's1', name: 'Corte', price: 200, duration_minutes: 30 },
  ],
};

test('config vieja (sin campos nuevos) valida OK', () => {
  const result = ConfigSchema.safeParse(baseConfig);
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
});

test('config con review_url / map_url / attributes valida OK', () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig,
    business: {
      ...baseConfig.business,
      review_url: 'https://g.page/r/review',
      map_url: 'https://maps.google.com/?q=x',
      attributes: { pays_card: true, parking: false },
    },
  });
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
});

test('config con price_min / price_max / price_note valida OK', () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig,
    services: [
      { id: 's1', name: 'Tinte', price: 0, price_min: 500, price_max: 900, duration_minutes: 90 },
      { id: 's2', name: 'Barba', price: 0, price_min: 120, price_note: 'según estilo', duration_minutes: 20 },
    ],
  });
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
});

test('attributes con valor no booleano es rechazado', () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig,
    business: { ...baseConfig.business, attributes: { pays_card: 'sí' } },
  });
  assert.equal(result.success, false);
});
