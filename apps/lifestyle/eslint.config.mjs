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
  'appointment_audit', 'management_audit', 'appointment_tips',
].join('|');

const rawTenantFromRestriction = {
  selector: `CallExpression[callee.property.name='from'][arguments.0.value=/^(${TENANT_TABLES})$/]`,
  message:
    "Aislamiento multi-tenant: no uses .from('<tabla de tenant>') crudo. Usá tenantDb(businessId).table(...) (src/lib/tenantDb.ts). Para un caso legítimo cross-tenant, agregá `// eslint-disable-next-line no-restricted-syntax -- <motivo>`.",
};

// ─── Guard de privacidad de propinas (Paso 7 rediseño barbero) ────────────────
// La propina es PRIVADA del dueño. `appointment_tips` solo puede referenciarse en
// el módulo barbero: write (src/app/staff/actions.ts), read (src/lib/barberDay.ts)
// y su UI (src/components/staff/**). Cualquier otra referencia — un select del
// dashboard, un reporte, el Realtime — es error de build. Respaldo repo-wide
// (incluye packages/engine y strings no-literales): tests/tipsPrivacy.test.ts.
const tipsPrivacyRestriction = {
  selector: "Literal[value='appointment_tips']",
  message:
    'Privacidad de propinas: appointment_tips es barbero-only (write src/app/staff/actions.ts, read src/lib/barberDay.ts, UI src/components/staff). Ninguna vista/query/reporte del dueño o asistente puede tocarla.',
};

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
    'no-restricted-syntax': ['error', rawTenantFromRestriction],
  },
};

// NOTA flat-config: `no-restricted-syntax` NO se mergea entre bloques — el último
// que matchea PISA al anterior. Por eso este bloque re-incluye la restricción
// tenant: para sus files valen AMBAS. Los archivos allowlisted (ignores) caen al
// bloque anterior y conservan el guard tenant sin el de propinas.
const noTipsOutsideBarberAppLib = {
  files: [
    'src/app/**/*.{ts,tsx}',
    'src/lib/**/*.{ts,tsx}',
  ],
  ignores: [
    'src/app/staff/actions.ts',
    'src/lib/barberDay.ts',
  ],
  rules: {
    'no-restricted-syntax': ['error', rawTenantFromRestriction, tipsPrivacyRestriction],
  },
};

// Los components no están bajo el guard tenant (usan el browser client con RLS,
// p. ej. DashboardRealtimeProvider) — acá va SOLO el guard de propinas.
const noTipsInComponents = {
  files: ['src/components/**/*.{ts,tsx}'],
  ignores: ['src/components/staff/**'],
  rules: {
    'no-restricted-syntax': ['error', tipsPrivacyRestriction],
  },
};

export default [...nextConfig, noRawTenantFrom, noTipsOutsideBarberAppLib, noTipsInComponents];
