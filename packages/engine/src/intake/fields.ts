// ─── Intake Fields ────────────────────────────────────────────────────────────
// Maps field IDs (from client.config.intake.fields) to their IntakeField definitions.
// All labels are in Spanish. Sensitive fields are shown with emphasis in the dashboard.

import type { IntakeField } from './types';

// ─── Field definitions ────────────────────────────────────────────────────────

/**
 * Canonical definitions for all supported intake field IDs.
 * To add a new field: add an entry here — no other file changes required.
 */
const FIELD_DEFINITIONS: Record<string, IntakeField> = {
  nombre_completo: {
    id: 'nombre_completo',
    label: 'Nombre completo',
    type: 'text',
    required: true,
    sensitive: false,
  },
  fecha_nacimiento: {
    id: 'fecha_nacimiento',
    label: 'Fecha de nacimiento',
    type: 'date',
    required: true,
    sensitive: false,
  },
  alergias_conocidas: {
    id: 'alergias_conocidas',
    label: 'Alergias conocidas',
    type: 'textarea',
    required: false,
    sensitive: true,
  },
  medicamentos_actuales: {
    id: 'medicamentos_actuales',
    label: 'Medicamentos actuales',
    type: 'textarea',
    required: false,
    sensitive: true,
  },
  motivo_consulta: {
    id: 'motivo_consulta',
    label: 'Motivo de consulta',
    type: 'textarea',
    required: true,
    sensitive: false,
  },
  tratamientos_previos: {
    id: 'tratamientos_previos',
    label: 'Tratamientos previos',
    type: 'textarea',
    required: false,
    sensitive: false,
  },
  datos_facturacion: {
    id: 'datos_facturacion',
    label: 'Datos de facturación (opcional)',
    type: 'textarea',
    required: false,
    sensitive: false,
  },
};

// ─── getFieldsForClient ───────────────────────────────────────────────────────

/**
 * Returns IntakeField definitions for the field IDs configured in client.config.ts,
 * preserving the order defined in the config.
 * Unknown field IDs are silently skipped.
 */
export function getFieldsForClient(fieldIds: readonly string[]): IntakeField[] {
  return fieldIds.reduce<IntakeField[]>((acc, id) => {
    const field = FIELD_DEFINITIONS[id];
    if (field) acc.push(field);
    return acc;
  }, []);
}
