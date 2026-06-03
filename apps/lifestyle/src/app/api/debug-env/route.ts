// ─── TEMPORARY debug endpoint ─────────────────────────────────────────────────
// GET /api/debug-env — diagnóstico de env vars en el runtime de producción.
// NO expone valores completos: solo booleans y prefijos cortos.
// ⚠️ ELIMINAR este archivo una vez terminado el diagnóstico.

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    {
      hasSupabaseUrl: !!process.env['NEXT_PUBLIC_SUPABASE_URL'],
      supabaseUrlPrefix: process.env['NEXT_PUBLIC_SUPABASE_URL']?.substring(0, 30) ?? 'UNDEFINED',
      hasServiceRoleKey: !!process.env['SUPABASE_SERVICE_ROLE_KEY'],
      serviceRoleKeyPrefix: process.env['SUPABASE_SERVICE_ROLE_KEY']?.substring(0, 10) ?? 'UNDEFINED',
      hasWhatsappToken: !!process.env['WHATSAPP_ACCESS_TOKEN'],
      hasAnthropicKey: !!process.env['ANTHROPIC_API_KEY'],
      nodeEnv: process.env['NODE_ENV'] ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
