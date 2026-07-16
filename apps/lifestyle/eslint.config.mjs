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
  // ── Superficie migrada. Fase 2 tanda 1: TODO app/api (menos auth y bot).
  //    Tanda 2: los server actions (`'use server'`). Se listan por archivo a
  //    propósito — NO por directorio — para no arrastrar los Server Components
  //    de esas carpetas (p.ej. staff/page.tsx), que son tandas posteriores. Las
  //    siguientes tandas suman esos pages, lib y engine hasta cubrir todo src/. ──
  files: [
    'src/app/api/**/*.{ts,tsx}',
    'src/app/staff/assistant-actions.ts',
    'src/app/staff/actions.ts',
    'src/app/dashboard/actions.ts',
  ],
  ignores: [
    'src/app/api/auth/**',  // login PIN/email — tanda auth
    'src/app/api/bot/**',   // webhook del bot — tanda bot
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
