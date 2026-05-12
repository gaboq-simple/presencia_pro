// ─── Auth helpers ──────────────────────────────────────────────────────────────
// Server-side session and role verification.
// The role is always checked against sellers.is_operator — never from the JWT.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Seller } from '@presenciapro/engine/types';

export interface Session {
  readonly userId: string;
  readonly seller: Seller;
}

/**
 * Returns the active session or null.
 * Reads the Supabase auth user, then queries sellers to confirm the record
 * is active. Must be called from a Server Component, Action, or Route Handler.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: seller } = await supabase
    .from('sellers')
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true)
    .single<Seller>();

  if (!seller) return null;

  return { userId: user.id, seller };
}

/**
 * Asserts the request is authenticated and (optionally) that the seller
 * has the required role. Redirects on failure — never throws.
 */
export async function requireRole(role: 'seller' | 'operator'): Promise<Session> {
  const session = await getSession();

  if (!session) redirect('/login');

  // Guard: reject if operator access is required but seller is not an operator
  if (role === 'operator' && !session.seller.is_operator) {
    redirect('/dashboard');
  }

  return session;
}
