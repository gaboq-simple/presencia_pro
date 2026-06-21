// S5-BOT-12 — Test de relación de caps del contador de escape estructural.
// Puro y determinista: sin red, sin Supabase, sin Anthropic.
// Ejecutar: npm test
//
// Blinda la invariante de diseño: STRUCTURAL_CAP debe ser ESTRICTAMENTE mayor
// que cualquier cap de clarificación/retry por-estado. Si no lo fuera, el
// contador global cortaría el flujo ANTES de que un estado tenga su propia
// oportunidad de escalar — el global es la red de seguridad, no el primer
// recurso. Los caps se IMPORTAN reales (no se hardcodean) para que un cambio
// futuro de cualquiera de ellos rompa este test si invalida la relación.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STRUCTURAL_CAP } from '../packages/engine/src/bot/lifestyle/router';
import { MAX_TOTAL_ATTEMPTS as STAFF_CAP }   from '../packages/engine/src/bot/lifestyle/states/qualifyingStaff';
import { MAX_TOTAL_ATTEMPTS as DATETIME_CAP } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import { MAX_TOTAL_ATTEMPTS as SERVICE_CAP }  from '../packages/engine/src/bot/lifestyle/states/qualifyingService';
import { MAX_CLARIFY_ATTEMPTS as CONFIRMING_CAP } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { MAX_RETRIES as BOOKING_NAME_CAP }   from '../packages/engine/src/bot/lifestyle/states/awaitingBookingName';
import { MAX_RETRIES as CONFIRMATION_CAP }   from '../packages/engine/src/bot/lifestyle/states/awaitingConfirmation';

const PER_STATE_CAPS: Record<string, number> = {
  QUALIFYING_STAFF:       STAFF_CAP,
  QUALIFYING_DATETIME:    DATETIME_CAP,
  QUALIFYING_SERVICE:     SERVICE_CAP,
  CONFIRMING_APPOINTMENT: CONFIRMING_CAP,
  AWAITING_BOOKING_NAME:  BOOKING_NAME_CAP,
  AWAITING_CONFIRMATION:  CONFIRMATION_CAP,
};

test('STRUCTURAL_CAP > cada cap por-estado individual', () => {
  for (const [state, cap] of Object.entries(PER_STATE_CAPS)) {
    assert.ok(
      STRUCTURAL_CAP > cap,
      `STRUCTURAL_CAP (${STRUCTURAL_CAP}) debe ser > cap de ${state} (${cap})`,
    );
  }
});

test('STRUCTURAL_CAP > max(todos los caps por-estado)', () => {
  const maxPerState = Math.max(...Object.values(PER_STATE_CAPS));
  assert.ok(
    STRUCTURAL_CAP > maxPerState,
    `STRUCTURAL_CAP (${STRUCTURAL_CAP}) debe ser > max per-estado (${maxPerState})`,
  );
});
