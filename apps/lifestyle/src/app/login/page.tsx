// ─── Login ────────────────────────────────────────────────────────────────────
// Server Component wrapper — resuelve el nombre del negocio por ?slug= y pasa
// al formulario client. Fallback: "PresenciaPro" si no hay contexto.

import { createClient } from '@supabase/supabase-js';
import LoginForm from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const { slug } = await searchParams;
  let businessName: string | null = null;

  if (slug) {
    const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (url && key) {
      const supabase = createClient(url, key);
      const { data } = await supabase
        .from('businesses')
        .select('name')
        .eq('slug', slug)
        .eq('active', true)
        .maybeSingle();
      businessName = data?.name ?? null;
    }
  }

  return <LoginForm businessName={businessName} />;
}
