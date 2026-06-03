// ─── Lifestyle Bot — Catalog Cache ───────────────────────────────────────────
// Provee servicios y staff activos del negocio con cache TTL 300s.
// Cache in-memory por proceso (Map con timestamps) — framework-agnostic.
// Vercel Fluid Compute reutiliza instancias entre requests → cache efectivo.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServiceRow, StaffRow } from './types';

// ─── TTL in-memory cache ──────────────────────────────────────────────────────

const CACHE_TTL_MS = 300_000; // 300 segundos

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const serviceCache      = new Map<string, CacheEntry<ServiceRow[]>>();
const staffCache        = new Map<string, CacheEntry<StaffRow[]>>();
// Clave: `${businessId}:${serviceId}`
const staffServiceCache = new Map<string, CacheEntry<StaffRow[]>>();

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() < entry.expiresAt;
}

// ─── getCatalog ───────────────────────────────────────────────────────────────

/**
 * Retorna los servicios activos del negocio.
 * Cache TTL 300s por businessId.
 */
export async function getCatalog(
  businessId: string,
  supabase: SupabaseClient,
): Promise<ServiceRow[]> {
  const cached = serviceCache.get(businessId);
  if (isFresh(cached)) return cached.data;

  const { data, error } = await supabase
    .from('services')
    .select('id, name, description, duration_minutes, price, currency, price_min, price_max, price_note')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');

  if (error) {
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'catalog',
      event:       'services_query_failed',
      business_id: businessId,
      error:       error.message,
    }));
    return [];
  }
  if (!data) return [];

  const rows = data as ServiceRow[];
  serviceCache.set(businessId, { data: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

// ─── getActiveStaff ───────────────────────────────────────────────────────────

/**
 * Retorna el staff activo del negocio.
 * Cache TTL 300s por businessId.
 */
export async function getActiveStaff(
  businessId: string,
  supabase: SupabaseClient,
): Promise<StaffRow[]> {
  const cached = staffCache.get(businessId);
  if (isFresh(cached)) return cached.data;

  const { data, error } = await supabase
    .from('staff')
    .select('id, name, whatsapp_id')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');

  if (error) {
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'catalog',
      event:       'staff_query_failed',
      business_id: businessId,
      error:       error.message,
    }));
    return [];
  }
  if (!data) return [];

  const rows = data as StaffRow[];
  staffCache.set(businessId, { data: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

/**
 * Retorna el staff activo que ofrece un servicio específico.
 * Cruza con staff_services. Cache TTL 300s por businessId+serviceId.
 */
export async function getStaffForService(
  businessId: string,
  serviceId: string,
  supabase: SupabaseClient,
): Promise<StaffRow[]> {
  const cacheKey = `${businessId}:${serviceId}`;
  const cached = staffServiceCache.get(cacheKey);
  if (isFresh(cached)) return cached.data;

  const { data, error } = await supabase
    .from('staff')
    .select('id, name, whatsapp_id, staff_services!inner(service_id)')
    .eq('business_id', businessId)
    .eq('active', true)
    .eq('staff_services.service_id', serviceId)
    .order('name');

  if (error) {
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'catalog',
      event:       'staff_for_service_query_failed',
      business_id: businessId,
      service_id:  serviceId,
      error:       error.message,
    }));
    return [];
  }
  if (!data) return [];
  const rows = (data as Array<StaffRow & { staff_services: unknown }>).map(
    ({ staff_services: _ss, ...rest }) => rest,
  );
  staffServiceCache.set(cacheKey, { data: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

// ─── Invalidar cache ──────────────────────────────────────────────────────────

/** Invalida la cache de catálogo y staff para un negocio. */
export function invalidateBusinessCache(businessId: string): void {
  serviceCache.delete(businessId);
  staffCache.delete(businessId);
  // Limpiar todas las entradas de staffServiceCache para este negocio
  for (const key of staffServiceCache.keys()) {
    if (key.startsWith(businessId + ':')) {
      staffServiceCache.delete(key);
    }
  }
}
