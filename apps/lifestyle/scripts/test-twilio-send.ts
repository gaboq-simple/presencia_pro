/**
 * apps/lifestyle/scripts/test-twilio-send.ts
 * Envía un mensaje de prueba vía Twilio WhatsApp Sandbox para verificar
 * que las credenciales y el provider están correctamente configurados.
 *
 * Uso (desde la raíz del monorepo):
 *   npx ts-node --project tsconfig.scripts.json \
 *     apps/lifestyle/scripts/test-twilio-send.ts +521XXXXXXXXXX
 *
 * Variables requeridas (apps/lifestyle/.env.local):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM   ← ej: whatsapp:+14155238886
 *
 * Antes de recibir el mensaje, el destinatario debe haber enviado
 * "join <sandbox-keyword>" al número del Sandbox en Twilio Console.
 */

import fs from 'fs';
import path from 'path';

// ─── Cargar .env.local ────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  const envPath = path.resolve(__dirname, '../../../apps/lifestyle/.env.local');
  const fallback = path.resolve(process.cwd(), 'apps/lifestyle/.env.local');

  let content: string | null = null;

  for (const p of [envPath, fallback]) {
    if (fs.existsSync(p)) {
      content = fs.readFileSync(p, 'utf-8');
      break;
    }
  }

  if (!content) {
    console.error(
      '❌ No se encontró apps/lifestyle/.env.local\n' +
      '   Copia apps/lifestyle/.env.local.example y rellena las credenciales.',
    );
    process.exit(1);
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key   = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ─── Validar argumentos ───────────────────────────────────────────────────────

function getTargetPhone(): string {
  const raw = process.argv[2];
  if (!raw) {
    console.error(
      '❌ Falta el número de destino.\n' +
      '   Uso: npx ts-node --project tsconfig.scripts.json \\\n' +
      '          apps/lifestyle/scripts/test-twilio-send.ts +521XXXXXXXXXX',
    );
    process.exit(1);
  }

  // Normalizar: quitar '+' inicial y espacios
  return raw.replace(/^\+/, '').replace(/\s/g, '');
}

// ─── Enviar mensaje ───────────────────────────────────────────────────────────

async function sendTestMessage(to: string): Promise<void> {
  const accountSid = process.env['TWILIO_ACCOUNT_SID'];
  const authToken  = process.env['TWILIO_AUTH_TOKEN'];
  const fromRaw    = process.env['TWILIO_WHATSAPP_FROM'] ?? 'whatsapp:+14155238886';

  if (!accountSid || !authToken) {
    console.error(
      '❌ TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN son requeridos.\n' +
      '   Agrega las credenciales a apps/lifestyle/.env.local',
    );
    process.exit(1);
  }

  const fromFormatted = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;
  const toFormatted   = `whatsapp:+${to}`;

  const url  = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const body = new URLSearchParams({
    From: fromFormatted,
    To:   toFormatted,
    Body: 'Hola desde PresenciaPro 👋 Bot de prueba activo.',
  });

  console.log(`\n📤 Enviando mensaje de prueba...`);
  console.log(`   De: ${fromFormatted}`);
  console.log(`   A:  ${toFormatted}`);
  console.log(`   SID: ${accountSid.slice(0, 8)}...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (response.ok) {
    const data = await response.json() as { sid: string; status: string };
    console.log(`\n✅ Mensaje enviado exitosamente.`);
    console.log(`   SID del mensaje: ${data.sid}`);
    console.log(`   Estado: ${data.status}`);
    console.log(`\n   Verifica que el mensaje llegó al WhatsApp +${to}.`);
    console.log(`   Si no llegó, asegúrate que el número haya enviado`);
    console.log(`   "join <keyword>" al Sandbox de Twilio.`);
  } else {
    const err = await response.json() as { message?: string; code?: number };
    console.error(`\n❌ Error al enviar mensaje: ${err.message ?? `HTTP ${response.status}`}`);
    if (err.code) {
      console.error(`   Código de error Twilio: ${err.code}`);
      console.error(`   Ver: https://www.twilio.com/docs/api/errors/${err.code}`);
    }
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

loadEnvLocal();
const phone = getTargetPhone();
sendTestMessage(phone).catch((err: unknown) => {
  console.error('❌ Error inesperado:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
