// ─── TEMPORARY debug endpoint ─────────────────────────────────────────────────
// GET /api/debug-env — diagnóstico de env vars en el runtime de producción.
// NO expone valores completos: solo booleans y prefijos cortos.
// ⚠️ ELIMINAR este archivo una vez terminado el diagnóstico.

export const dynamic = 'force-dynamic';

// Decodes ONLY the non-secret `role` and `ref` claims from a Supabase JWT key.
// Does not expose the signature or any secret material.
function jwtClaims(key: string | undefined): { role: string | null; ref: string | null } | null {
  if (!key) return null;
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as {
      role?: string;
      ref?: string;
    };
    return { role: payload.role ?? null, ref: payload.ref ?? null };
  } catch {
    return null;
  }
}

export async function GET() {
  return Response.json(
    {
      hasSupabaseUrl: !!process.env['NEXT_PUBLIC_SUPABASE_URL'],
      supabaseUrlPrefix: process.env['NEXT_PUBLIC_SUPABASE_URL']?.substring(0, 30) ?? 'UNDEFINED',
      hasServiceRoleKey: !!process.env['SUPABASE_SERVICE_ROLE_KEY'],
      serviceRoleKeyPrefix: process.env['SUPABASE_SERVICE_ROLE_KEY']?.substring(0, 10) ?? 'UNDEFINED',
      // Non-secret JWT claims to distinguish anon vs service_role and confirm project ref.
      serviceRoleKeyClaims: jwtClaims(process.env['SUPABASE_SERVICE_ROLE_KEY']),
      anonKeyClaims: jwtClaims(process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']),
      hasWhatsappToken: !!process.env['WHATSAPP_ACCESS_TOKEN'],
      hasAnthropicKey: !!process.env['ANTHROPIC_API_KEY'],
      nodeEnv: process.env['NODE_ENV'] ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
