/**
 * scripts/new-client.ts
 * Scaffolding para nuevas instancias de PresenciaPro.
 *
 * Uso:
 *   npx ts-node scripts/new-client.ts --id=dr-lopez --name="Dr. López"
 *   npx ts-node scripts/new-client.ts --id=salon-ejemplo --name="Salón Ejemplo" --profile=lifestyle
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Profile = 'medical' | 'lifestyle';

// ─── Argumentos ───────────────────────────────────────────────────────────────

function parseArgs(): { id: string; name: string; profile: Profile | undefined } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined =>
    args.find((a) => a.startsWith(`--${flag}=`))?.split('=').slice(1).join('=');

  const id = get('id');
  const name = get('name');
  const profileArg = get('profile');

  if (!id || !name) {
    console.error(
      'Uso: npx ts-node scripts/new-client.ts --id=<slug> --name="<Nombre>" [--profile=medical|lifestyle]',
    );
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(id)) {
    console.error('--id debe ser kebab-case: solo letras minúsculas, números y guiones.');
    process.exit(1);
  }
  if (profileArg !== undefined && profileArg !== 'medical' && profileArg !== 'lifestyle') {
    console.error('--profile debe ser "medical" o "lifestyle".');
    process.exit(1);
  }

  return { id, name, profile: profileArg as Profile | undefined };
}

// ─── Prompt interactivo ───────────────────────────────────────────────────────

function askProfile(): Promise<Profile> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n¿Qué perfil de cliente es este?\n');
    console.log('  1) medical    — médicos, dentistas, psicólogos, nutriólogos');
    console.log('                  (bot con calificación completa, intake, modalidades)');
    console.log('  2) lifestyle  — peluquería, uñas, spa, estética');
    console.log('                  (bot simplificado, agenda directa, sin intake)\n');
    rl.question('Elige [1/2]: ', (answer) => {
      rl.close();
      if (answer.trim() === '2' || answer.trim().toLowerCase() === 'lifestyle') {
        resolve('lifestyle');
      } else {
        resolve('medical');
      }
    });
  });
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'clients', 'dra-quevedo');

function newClientDir(id: string): string {
  return path.join(ROOT, 'clients', id);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function copyDir(src: string, dest: string, skip: string[] = []): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skip);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

// ─── Placeholder medical ──────────────────────────────────────────────────────

function buildMedicalConfig(id: string, name: string): string {
  return `import type { ClientConfig } from '@presenciapro/engine/types';

export const clientConfig = {

  profile: 'medical' as const,

  // ─── IDENTIDAD ───────────────────────────────────────────────────────────
  client: {
    id: '${id}',
    name: '${name}',
    specialty: 'PENDIENTE — ej: Medicina Estética',
    domain: 'PENDIENTE — ej: ${id}.com.mx',
    timezone: 'America/Mexico_City',
    locale: 'es-MX',
  },

  // ─── PERSONALIDAD DEL BOT ────────────────────────────────────────────────
  bot: {
    assistantName: 'PENDIENTE — ej: Sofía',
    tone: 'professional' as const,
    greeting: 'PENDIENTE — ej: Hola, soy Sofía, asistente de ${name}. ¿En qué te puedo ayudar?',
    awayMessage: 'PENDIENTE — ej: En este momento estamos fuera de horario. Te respondo mañana.',
    fallbackMessage: 'PENDIENTE — ej: Déjame verificar eso y te confirmo en breve.',
    followUpDelayHours: 24,
    followUpMessage: 'PENDIENTE — ej: Hola, ¿pudiste revisar la información? Quedamos a tus órdenes.',
    officeHours: {
      start: '09:00',
      end: '18:00',
      days: [1, 2, 3, 4, 5],
    },
  },

  // ─── ESPECIALISTAS ───────────────────────────────────────────────────────
  specialists: [
    {
      id: 'PENDIENTE',
      name: '${name}',
      area: 'PENDIENTE — ej: Medicina Estética',
      tagline: 'PENDIENTE — ej: Resultados naturales, atención personalizada',
      credentials: ['PENDIENTE — ej: Cédula Profesional'],
      location: 'PENDIENTE — ej: Zona Esmeralda, Estado de México',
      whatsapp: '5210000000000',
      calendarId: 'PENDIENTE@gmail.com',
      photo: '/images/doctor.jpg',
    },
  ],

  // ─── AGENDA ──────────────────────────────────────────────────────────────
  scheduling: {
    slotDurationMinutes: 45,
    bufferBetweenSlotsMinutes: 15,
    emergencySlotsPerDay: 1,
    advanceBookingDays: 30,
    reminderSchedule: [24, 2],
    cancellationWindowHours: 12,
    confirmationRequired: true,
    confirmationWindowHours: 2,
  },

  // ─── SERVICIOS ───────────────────────────────────────────────────────────
  services: [
    {
      id: 'consulta-inicial',
      name: 'Consulta Inicial',
      description: 'PENDIENTE — descripción del servicio.',
      durationMinutes: 30,
      icon: 'sparkles' as const,
      modes: ['consultorio'] as const,
      specialistId: 'PENDIENTE',
      postConsultaProducts: [],
    },
  ],

  // ─── MODALIDADES DE ATENCIÓN ─────────────────────────────────────────────
  serviceModes: {
    domicilio: {
      label: 'A domicilio',
      description: 'PENDIENTE — descripción del servicio a domicilio.',
      availableZones: ['CDMX'],
      additionalCost: 0,
    },
    consultorio: {
      label: 'En consultorio',
      description: 'PENDIENTE — descripción de la atención en consultorio.',
      address: 'PENDIENTE — dirección del consultorio',
      googleMapsUrl: '',
      parkingAvailable: false,
    },
  },

  // ─── INTAKE PRE-CONSULTA ─────────────────────────────────────────────────
  intake: {
    fields: ['nombre_completo', 'motivo_consulta'],
    requiresSignature: false,
    signatureLabel: 'PENDIENTE — ej: Acepto el aviso de privacidad y consentimiento informado',
    privacyUrl: '/privacidad',
  },

  // ─── CONTACTO ─────────────────────────────────────────────────────────────
  contact: {
    whatsapp: '5210000000000',
    whatsappMessage: 'PENDIENTE — ej: Hola, me gustaría agendar una cita con ${name}',
    email: '',
    bookingUrl: '',
    instagram: '',
    tiktok: '',
  },

  // ─── POST-CONSULTA ────────────────────────────────────────────────────────
  postConsulta: {
    reviewRequestDelayHours: 24,
    reviewUrl: '',
    reactivationDays: 60,
    reactivationMessage: 'PENDIENTE — ej: Hola, han pasado 2 meses desde tu última visita. ¿Te gustaría agendar tu seguimiento?',
  },

  // ─── PRODUCTOS POST-CONSULTA ──────────────────────────────────────────────
  products: [],

  // ─── SEO ──────────────────────────────────────────────────────────────────
  seo: {
    title: '${name} — PENDIENTE (mín 10 chars)',
    description: 'PENDIENTE — descripción del consultorio y servicios de ${name}. Mínimo 50 caracteres para SEO.',
    keywords: ['${id}'],
  },

  // ─── DISEÑO ───────────────────────────────────────────────────────────────
  design: {
    colors: {
      primary: '#000000',
      primaryLight: '#333333',
      primaryDark: '#000000',
      background: '#FFFFFF',
      surface: '#F5F5F5',
      text: '#1A1A1A',
      textMuted: '#6B7280',
      border: '#E5E7EB',
      white: '#FFFFFF',
    },
    fonts: {
      heading: 'Inter',
      body: 'Inter',
    },
    borderRadius: '0.5rem',
  },

} satisfies ClientConfig;
`;
}

// ─── Placeholder lifestyle ────────────────────────────────────────────────────

function buildLifestyleConfig(id: string, name: string): string {
  return `import type { ClientConfig } from '@presenciapro/engine/types';

export const clientConfig = {

  profile: 'lifestyle' as const,

  // ─── IDENTIDAD ───────────────────────────────────────────────────────────
  client: {
    id: '${id}',
    name: '${name}',
    specialty: 'PENDIENTE — ej: Estética y Belleza',
    domain: 'PENDIENTE — ej: ${id}.com.mx',
    timezone: 'America/Mexico_City',
    locale: 'es-MX',
  },

  // ─── PERSONALIDAD DEL BOT ────────────────────────────────────────────────
  bot: {
    assistantName: 'PENDIENTE — ej: Valeria',
    tone: 'friendly' as const,
    greeting: 'PENDIENTE — ej: Hola, soy Valeria de ${name}. ¿En qué te puedo ayudar?',
    awayMessage: 'PENDIENTE — ej: Estamos fuera de horario. Te respondemos en cuanto abramos.',
    fallbackMessage: 'PENDIENTE — ej: Déjame consultar eso y te confirmo enseguida.',
    followUpDelayHours: 24,
    followUpMessage: 'PENDIENTE — ej: Hola, ¿pudiste revisar la información? Aquí seguimos para ayudarte.',
    officeHours: {
      start: '10:00',
      end: '20:00',
      days: [1, 2, 3, 4, 5, 6],
    },
  },

  // ─── ESPECIALISTAS ───────────────────────────────────────────────────────
  specialists: [
    {
      id: 'PENDIENTE',
      name: '${name}',
      area: 'PENDIENTE — ej: Corte y colorimetría',
      tagline: 'PENDIENTE — ej: Expertos en color y estilo',
      credentials: ['PENDIENTE — ej: 10 años de experiencia'],
      location: 'PENDIENTE — ej: Colonia Roma, CDMX',
      whatsapp: '5210000000000',
      calendarId: 'PENDIENTE@gmail.com',
      photo: '/images/specialist.jpg',
    },
  ],

  // ─── AGENDA ──────────────────────────────────────────────────────────────
  scheduling: {
    slotDurationMinutes: 60,
    bufferBetweenSlotsMinutes: 0,
    emergencySlotsPerDay: 0,
    advanceBookingDays: 30,
    reminderSchedule: [24, 2],
    cancellationWindowHours: 12,
    confirmationRequired: false,
    confirmationWindowHours: 2,
  },

  // ─── SERVICIOS ───────────────────────────────────────────────────────────
  // Lifestyle: sin modalidades (siempre en local), sin productos post-consulta.
  services: [
    {
      id: 'corte',
      name: 'PENDIENTE — ej: Corte',
      description: 'PENDIENTE — descripción del servicio.',
      durationMinutes: 60,
      icon: 'sparkles' as const,
      specialistId: 'PENDIENTE',
    },
  ],

  // ─── UBICACIÓN DEL LOCAL ─────────────────────────────────────────────────
  address: 'PENDIENTE — dirección completa del local',
  googleMapsUrl: '',

  // ─── CONTACTO ─────────────────────────────────────────────────────────────
  contact: {
    whatsapp: '5210000000000',
    whatsappMessage: 'PENDIENTE — ej: Hola, me gustaría agendar una cita en ${name}',
    email: '',
    bookingUrl: '',
    instagram: '',
    tiktok: '',
  },

  // ─── POST-CONSULTA ────────────────────────────────────────────────────────
  postConsulta: {
    reviewRequestDelayHours: 24,
    reviewUrl: '',
    reactivationDays: 45,
    reactivationMessage: 'PENDIENTE — ej: Hola, hace tiempo que no te vemos por aquí. ¿Agendamos tu próxima cita?',
  },

  // ─── SEO ──────────────────────────────────────────────────────────────────
  seo: {
    title: '${name} — PENDIENTE (mín 10 chars)',
    description: 'PENDIENTE — descripción de ${name} y sus servicios. Mínimo 50 caracteres para SEO.',
    keywords: ['${id}'],
  },

  // ─── DISEÑO ───────────────────────────────────────────────────────────────
  design: {
    colors: {
      primary: '#000000',
      primaryLight: '#333333',
      primaryDark: '#000000',
      background: '#FFFFFF',
      surface: '#F5F5F5',
      text: '#1A1A1A',
      textMuted: '#6B7280',
      border: '#E5E7EB',
      white: '#FFFFFF',
    },
    fonts: {
      heading: 'Inter',
      body: 'Inter',
    },
    borderRadius: '0.5rem',
  },

} satisfies ClientConfig;
`;
}

// ─── .env.local template ──────────────────────────────────────────────────────

function buildEnvTemplate(id: string): string {
  return `# ─── SUPABASE ─────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ─── GOOGLE CALENDAR ───────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# ─── WHATSAPP BUSINESS API ─────────────────────────────────────
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# ─── CLAUDE API ────────────────────────────────────────────────
ANTHROPIC_API_KEY=

# ─── RESEND ────────────────────────────────────────────────────
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# ─── CLIENTE ───────────────────────────────────────────────────
NEXT_PUBLIC_CLIENT_ID=${id}
`;
}

// ─── Checklist ────────────────────────────────────────────────────────────────

function printChecklist(id: string, profile: Profile): void {
  const medicalExtras =
    profile === 'medical'
      ? `[ ] Configurar intake: campos, firma digital, URL de privacidad\n[ ] Definir modalidades de atención (domicilio / consultorio)\n`
      : '';

  console.log(`
✓ Perfil: ${profile}
✓ Estructura creada en clients/${id}/

PENDIENTE ANTES DEL DEPLOY:
[ ] Llenar client.config.ts con los datos del cliente
${medicalExtras}[ ] Agregar credenciales en .env.local
[ ] Conectar Google Calendar del especialista
[ ] Verificar número WhatsApp Business
[ ] Configurar dominio en Vercel
[ ] Correr: npx ts-node --project tsconfig.scripts.json scripts/validate-config.ts --client=${id}
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { id, name, profile: profileArg } = parseArgs();
  const destDir = newClientDir(id);

  if (fs.existsSync(destDir)) {
    console.error(`Error: clients/${id}/ ya existe.`);
    process.exit(1);
  }

  // Resolver perfil: argumento CLI → prompt interactivo
  const profile: Profile = profileArg ?? (await askProfile());

  // Copiar estructura completa de dra-quevedo, omitiendo .next y node_modules
  copyDir(TEMPLATE_DIR, destDir, ['.next', 'node_modules', '.env.local']);

  // Reemplazar client.config.ts con el placeholder correcto para el perfil
  const config =
    profile === 'medical'
      ? buildMedicalConfig(id, name)
      : buildLifestyleConfig(id, name);

  writeFile(path.join(destDir, 'src', 'config', 'client.config.ts'), config);

  // Crear .env.local vacío con todas las variables
  writeFile(path.join(destDir, '.env.local'), buildEnvTemplate(id));

  // Actualizar package.json del nuevo cliente con su nombre
  const pkgPath = path.join(destDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
  pkg['name'] = id;
  writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  printChecklist(id, profile);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
