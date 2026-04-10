// ─── GET /api/calendar/slots ──────────────────────────────────────────────────
// Retorna slots disponibles para una fecha específica.
// Usado por RescheduleModal al seleccionar nueva fecha/hora.
//
// Query params:
//   date           YYYY-MM-DD  fecha en zona horaria del cliente
//   specialistId   string      ID del especialista
//   serviceId      string      ID del servicio (determina duración del slot)
//   excludeId      UUID        appointmentId a excluir del cálculo de ocupación
//                              (para no bloquear el slot actual de la cita que
//                              se está reagendando)
//
// Auth: sesión Supabase del médico (cookie).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getAvailableSlots } from '@presenciapro/engine/scheduling';
import type { GoogleCredentials } from '@presenciapro/engine/scheduling';
import { clientConfig } from '@/config/client.config';

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // ── Verificar sesión del médico ───────────────────────────────────────────
  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // ── Leer query params ─────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const dateParam       = searchParams.get('date');       // YYYY-MM-DD
  const specialistId    = searchParams.get('specialistId');
  const serviceId       = searchParams.get('serviceId');

  if (!dateParam || !specialistId || !serviceId) {
    return NextResponse.json(
      { error: 'Faltan parámetros: date, specialistId, serviceId' },
      { status: 400 },
    );
  }

  // Validar formato YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'date debe ser YYYY-MM-DD' }, { status: 400 });
  }

  // Guard: specialistId debe existir en el config
  const specialist = clientConfig.specialists.find((s) => s.id === specialistId);
  if (!specialist) {
    return NextResponse.json({ error: 'Especialista no encontrado' }, { status: 404 });
  }

  // Guard: serviceId debe existir en el config
  const service = clientConfig.services.find((s) => s.id === serviceId);
  if (!service) {
    return NextResponse.json({ error: 'Servicio no encontrado' }, { status: 404 });
  }

  // ── Leer env vars ─────────────────────────────────────────────────────────
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const googleClientId = process.env['GOOGLE_CLIENT_ID'];
  const googleSecret   = process.env['GOOGLE_CLIENT_SECRET'];
  const googleRefresh  = process.env['GOOGLE_REFRESH_TOKEN'];

  if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleSecret || !googleRefresh) {
    return NextResponse.json({ error: 'Configuración de servidor incompleta' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const credentials: GoogleCredentials = {
    clientId: googleClientId,
    clientSecret: googleSecret,
    refreshToken: googleRefresh,
  };

  // ── Construir el rango de un día ─────────────────────────────────────────
  // Rango de 26 horas desde UTC midnight del día solicitado.
  // Cubre cualquier timezone (max UTC+14) para que getAvailableSlots
  // filtre correctamente por fecha local en su lógica interna.
  const fromUtc = new Date(`${dateParam}T00:00:00Z`);
  const toUtc = new Date(fromUtc.getTime() + 26 * 60 * 60_000);

  // ── Obtener slots disponibles ─────────────────────────────────────────────
  try {
    const slots = await getAvailableSlots({
      clientId:    clientConfig.client.id,
      specialistId,
      serviceId,
      dateRange:   { from: fromUtc, to: toUtc },
      supabase,
      credentials,
      config:      clientConfig,
    });

    // Serializar a ISO strings para JSON (Date objects no son JSON-serializable)
    const serialized = slots.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt:   s.endsAt.toISOString(),
    }));

    return NextResponse.json({ slots: serialized });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error al obtener slots' },
      { status: 500 },
    );
  }
}
