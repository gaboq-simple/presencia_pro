// Fixtures deterministas para los tests de S4-BOT-04 (sin red, sin DB).
// Una barbería de prueba con servicios, horarios, dirección, reseñas y slug.

import type {
  LifestyleBusinessConfig,
  ServiceRow,
} from '../../packages/engine/src/bot/lifestyle/types';

export const APP_URL = 'https://presenciapro.app';

/** Negocio completo: con slug, reviewUrl, mapUrl y attributes. */
export const business: LifestyleBusinessConfig = {
  id: 'biz-1',
  name: 'Barbería El Corte',
  whatsappNumber: '5215555555555',
  whatsappPhoneNumberId: 'pnid-1',
  botName: 'Zlot',
  awayMessage: 'Estamos cerrados.',
  fallbackMessage: 'No entendí, puedes repetirlo?',
  officeHours: {
    '1': { start: '09:00', end: '18:00' },
    '2': { start: '09:00', end: '18:00' },
    '6': { start: '10:00', end: '14:00' },
    '0': null,
  },
  walkInBufferMinutes: 15,
  address: 'Av. Reforma 123, CDMX',
  timezone: 'America/Mexico_City',
  businessType: 'barbería',
  slug: 'barberia-el-corte',
  reviewUrl: 'https://g.page/r/review-el-corte',
  mapUrl: 'https://maps.google.com/?q=el-corte',
  attributes: { pays_card: true, parking: true, wifi: false },
};

/** Negocio mínimo: sin slug, sin reviewUrl, sin mapUrl, sin attributes. */
export const minimalBusiness: LifestyleBusinessConfig = {
  id: 'biz-2',
  name: 'Salón Simple',
  whatsappNumber: '5215555550000',
  whatsappPhoneNumberId: 'pnid-2',
  botName: 'Asistente',
  awayMessage: 'Cerrado.',
  fallbackMessage: 'No entendí.',
  officeHours: null,
  walkInBufferMinutes: 15,
  address: '',
  timezone: 'America/Mexico_City',
};

/** Servicio con precio exacto. */
export const serviceExact: ServiceRow = {
  id: 'svc-exact',
  name: 'Corte clásico',
  description: 'Corte a tijera y máquina',
  duration_minutes: 30,
  price: 200,
  currency: 'MXN',
};

/** Servicio con rango de precio (min + max). */
export const serviceRange: ServiceRow = {
  id: 'svc-range',
  name: 'Tinte',
  description: null,
  duration_minutes: 90,
  price: 0,
  currency: 'MXN',
  price_min: 500,
  price_max: 900,
};

/** Servicio con solo price_min ("desde") y una nota. */
export const serviceFromWithNote: ServiceRow = {
  id: 'svc-from',
  name: 'Barba',
  description: null,
  duration_minutes: 20,
  price: 0,
  currency: 'MXN',
  price_min: 120,
  price_note: 'según estilo',
};

/** Servicio sin información de precio. */
export const serviceNoPrice: ServiceRow = {
  id: 'svc-none',
  name: 'Consulta',
  description: null,
  duration_minutes: 15,
  price: 0,
  currency: 'MXN',
};

export const catalog: ServiceRow[] = [serviceExact, serviceRange, serviceFromWithNote];
