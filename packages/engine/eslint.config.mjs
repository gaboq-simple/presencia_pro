import tseslint from 'typescript-eslint';

// ─── Guard de aislamiento multi-tenant (blindaje por código) — engine ─────────
// Espejo de la regla en apps/lifestyle/eslint.config.mjs. El engine es un paquete
// aparte (no puede importar la config de la app), así que tiene la suya. El helper
// canónico vive en src/tenantDb.ts (la app lo re-exporta).
//
// SCOPE: sólo `src/bot/lifestyle/**` — la superficie VIVA de lifestyle. El resto del
// engine (scheduling/*, dashboard/queries, intake/*, bot/state, notifications/*) es
// el bot MÉDICO de dra-quevedo: 0 imports desde lifestyle, usa columnas que no existen
// en el schema lifestyle → código muerto para este producto. Migrar código muerto es
// riesgo sin retorno; queda fuera del glob a propósito. Si algún día entra código
// lifestyle nuevo fuera de bot/lifestyle, extender este `files`.
//
// Con esto + apps/lifestyle (todo src/), la garantía es global para lifestyle: un
// `.from('<tabla de tenant>')` crudo en cualquier ruta viva es error de lint.

const TENANT_TABLES = [
  'appointments', 'customers', 'services', 'staff', 'waitlist',
  'scheduled_notifications', 'bot_conversations', 'conversation_messages',
  'staff_schedule_exceptions', 'bot_logs', 'arco_requests',
  'appointment_audit', 'management_audit',
].join('|');

export default [
  {
    files: ['src/bot/lifestyle/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.property.name='from'][arguments.0.value=/^(${TENANT_TABLES})$/]`,
          message:
            "Aislamiento multi-tenant: no uses .from('<tabla de tenant>') crudo. Usá tenantDb(businessId).table(...) (packages/engine/src/tenantDb.ts). Para un caso legítimo cross-tenant, agregá `// eslint-disable-next-line no-restricted-syntax -- <motivo>`.",
        },
      ],
    },
  },
];
