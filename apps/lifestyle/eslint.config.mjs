import nextConfig from 'eslint-config-next';

// ─── Guard de aislamiento multi-tenant (blindaje por código) ──────────────────
// Prohíbe `.from('<tabla de tenant>')` CRUDO. El único camino a esas tablas es
// tenantDb(businessId).table(...) (ver src/lib/tenantDb.ts), que inyecta el
// .eq('business_id') sin que nadie lo pueda olvidar. Para un caso legítimo
// cross-tenant (lookup por id único global, scan por lote), usar:
//   // eslint-disable-next-line no-restricted-syntax -- <motivo>
// El motivo queda en el comentario → greppable y auditable.
//
// FASE 1: activo sólo en la superficie migrada (catálogo). La migración de los
// ~244 call-sites es por tandas; cada tanda EXTIENDE el glob `files` de abajo.
// Estado final: todo src/ (y ahí se vuelve la garantía global).

const TENANT_TABLES = [
  'appointments', 'customers', 'services', 'staff', 'waitlist',
  'scheduled_notifications', 'bot_conversations', 'conversation_messages',
  'staff_schedule_exceptions', 'bot_logs', 'arco_requests',
  'appointment_audit', 'management_audit',
].join('|');

const noRawTenantFrom = {
  // ── Superficie migrada. Tanda 1: app/api. Tanda 2: server actions. Tanda 3:
  //    src/lib. Tanda 4: Server Components. Tanda 5 (FINAL): auth + bot → se
  //    retiraron los ignores. El glob cubre TODO src/app + TODO src/lib SIN
  //    excepciones. Con la config espejo del engine (packages/engine, superficie
  //    bot/lifestyle), la GARANTÍA es GLOBAL: un `.from('<tabla de tenant>')`
  //    crudo en cualquier ruta viva de lifestyle es error de lint. Los casos
  //    legítimos (identidad por auth_id antes de conocer el tenant) llevan
  //    escape con motivo auditable. ──
  files: [
    'src/app/**/*.{ts,tsx}',
    'src/lib/**/*.{ts,tsx}',
  ],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: `CallExpression[callee.property.name='from'][arguments.0.value=/^(${TENANT_TABLES})$/]`,
        message:
          "Aislamiento multi-tenant: no uses .from('<tabla de tenant>') crudo. Usá tenantDb(businessId).table(...) (src/lib/tenantDb.ts). Para un caso legítimo cross-tenant, agregá `// eslint-disable-next-line no-restricted-syntax -- <motivo>`.",
      },
    ],
  },
};

export default [...nextConfig, noRawTenantFrom];
