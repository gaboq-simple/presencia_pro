// ─── ClientesModule — el módulo de Clientes (M6) ──────────────────────────────
// Client Component. Revive `searchCustomers`, que estaba escrita y MUERTA desde
// PR-5 de S6-UI-02 —sin un solo llamador—, detrás de un botón "Buscar cliente"
// que llevaba meses `disabled` con el título "Disponible en la próxima iteración".
//
// 🔴 EL PLAN DECÍA "enchufar DOS piezas" Y ERA MEDIA VERDAD. `ClientProfileCard`
// existe y está completa, pero NO se puede reusar acá: tanto ella como su ruta
// (`/api/customers/[id]/profile`) están atadas a "la próxima cita DEL BARBERO
// autenticado" — la ruta devuelve **404 cuando no hay una**, y la card trata ese
// 404 como silencio, así que montada para el asistente renderiza un vacío. Lo
// verifiqué en la ruta real antes de dejarlo puesto.
//
// Y NO se aflojó la ruta para que encajara. Ese 404 no es un descuido: es la
// restricción que escribieron para el barbero —"nunca muestra datos de clientes
// de otras citas que no sean la próxima"—, y quitarla convertiría a cualquier
// barbero con su PIN en alguien que puede consultar el historial de cualquier
// cliente. Ampliar un alcance de privacidad como efecto secundario de un paso de
// UI es exactamente lo que no se hace.
//
// Así que este módulo muestra lo que `searchCustomers` YA calcula y que es del
// cliente y no de una cita: visitas, última visita y con quién se atiende casi
// siempre. La ficha rica del asistente —notas incluidas— necesita su propia
// lectura, correctamente acotada, y quedó propuesta como tarea aparte.
//
// La búsqueda pide 2 caracteres (mismo piso que la action) y NO busca en cada
// tecla: espera a que la persona deje de escribir. Un ILIKE por letra sobre la
// tabla de clientes es tráfico que nadie pidió.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { searchCustomers, type CustomerSearchResult } from '@/app/staff/assistant-actions';

const MIN_LETRAS = 2;
const ESPERA_MS = 300;

function fmtUltimaVisita(iso: string | null): string {
  if (!iso) return 'sin visitas cerradas';
  return `última visita ${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(iso))}`;
}

export default function ClientesModule(): React.ReactElement {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<CustomerSearchResult[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<CustomerSearchResult | null>(null);

  const buscar = useCallback(async (texto: string) => {
    setBuscando(true);
    setError(null);
    try {
      setResultados(await searchCustomers(texto));
    } catch {
      setError('No se pudo buscar. Intenta de nuevo.');
    } finally {
      setBuscando(false);
    }
  }, []);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < MIN_LETRAS) { setResultados(null); return; }
    const id = setTimeout(() => void buscar(texto), ESPERA_MS);
    return () => clearTimeout(id);
  }, [q, buscar]);

  // Con alguien elegido, el módulo muestra lo que se sabe de ESA persona.
  if (abierto) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAbierto(null)}
            className="rounded-pill border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink-2 transition hover:bg-canvas active:scale-95"
          >
            ‹ Volver
          </button>
        </div>

        <section className="rounded-card border border-line bg-card px-4 py-4 shadow-card">
          <h2 className="text-lg font-semibold text-ink">{abierto.name}</h2>
          <p className="text-sm text-ink-2">{abierto.phone ?? 'sin teléfono'}</p>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-faint">Visitas cerradas</dt>
              <dd className="text-base font-semibold tabular-nums text-ink">{abierto.totalVisits}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Última visita</dt>
              <dd className="text-base font-semibold text-ink">
                {abierto.lastVisit
                  ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long' }).format(new Date(abierto.lastVisit))
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Se atiende con</dt>
              <dd className="text-base font-semibold text-ink">{abierto.preferredStaff ?? '—'}</dd>
            </div>
          </dl>

          {abierto.phone && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <a
                href={`https://wa.me/${abierto.phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[40px] rounded-pill border border-teal-border bg-tint-1 px-4 py-2 text-sm font-semibold text-teal-ink"
              >
                Mensaje
              </a>
              <a
                href={`tel:${abierto.phone}`}
                className="min-h-[40px] rounded-pill border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-2"
              >
                Llamar
              </a>
            </div>
          )}

          {/* Se dice qué falta, en vez de dejar el hueco sin explicar. */}
          <p className="mt-4 border-t border-line pt-3 text-xs text-faint">
            Las notas y el historial de faltas todavía no se ven acá.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <section className="rounded-card border border-line bg-card px-4 py-3 shadow-card">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">
            Buscar por nombre o teléfono
          </span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ej. Marco, o 55…"
            aria-label="Buscar cliente por nombre o teléfono"
            className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-base text-ink outline-none placeholder:text-faint focus-visible:border-teal-border"
          />
        </label>

        {error && <p className="mt-2 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>}

        {/* Tres estados y cada uno dice algo distinto: todavía no escribiste lo
            suficiente / estoy buscando / no hay nadie con ese nombre. Un "sin
            resultados" mostrado antes de buscar sería mentira. */}
        {q.trim().length > 0 && q.trim().length < MIN_LETRAS && (
          <p className="mt-3 text-xs text-faint">Escribe al menos {MIN_LETRAS} letras.</p>
        )}
        {buscando && <p className="mt-3 text-xs text-faint">Buscando…</p>}
        {!buscando && resultados !== null && resultados.length === 0 && (
          <p className="mt-3 text-xs text-faint">Nadie con ese nombre o teléfono.</p>
        )}

        {resultados !== null && resultados.length > 0 && (
          <ul className="mt-3 divide-y divide-line">
            {resultados.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setAbierto(c)}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-canvas"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                    <span className="block truncate text-xs text-ink-2">
                      {c.phone ?? 'sin teléfono'}
                      {' · '}
                      {c.totalVisits === 1 ? '1 visita' : `${c.totalVisits} visitas`}
                      {' · '}
                      {fmtUltimaVisita(c.lastVisit)}
                      {c.preferredStaff && ` · casi siempre con ${c.preferredStaff}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-faint" aria-hidden>›</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {q.trim().length === 0 && (
          <p className="mt-3 text-xs text-faint">
            Escribe un nombre o un teléfono para ver sus visitas, sus faltas y sus notas.
          </p>
        )}
      </section>
    </div>
  );
}
