// ─── FondoDeCaja — el piso contra el que se cuenta el cajón (S9-DIN-01) ───────
// Client Component. Vive JUNTO al cuadre, no en el panel de configuración, y no
// es capricho de ubicación: el fondo es el número que hace que el descuadre de
// al lado quiera decir algo. Leerlos separados es cómo se llega a un descuadre
// que nadie sabe interpretar.
//
// El defecto que cierra: `businesses.caja_fondo` tenía DOS LECTORES Y CERO
// ESCRITORES. Con el default 0 —y con la card del corte pidiendo contar TODO lo
// que hay en el cajón, fondo incluido— el efectivo contado salía por encima del
// esperado todos los días, por el tamaño exacto del fondo. Un descuadre que
// siempre miente en la misma dirección enseña a ignorar el que sí importa.
//
// Carga su estado con GET /api/business/config al montar y guarda con PATCH,
// igual que `ReportsConfigPanel` y `ReviewConfigPanel` — el patrón de los
// paneles de configuración del dueño.

'use client';

import { useEffect, useState } from 'react';
import { resolveFondo, esFondoError, fmtMonto } from '@/lib/caja';

export default function FondoDeCaja() {
  const [valor, setValor]     = useState('');
  const [guardado, setGuardado] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enVuelo, setEnVuelo]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [aviso, setAviso]       = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch('/api/business/config', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('no se pudo leer');
        const data = (await res.json()) as { caja_fondo?: number | string | null };
        if (!vivo) return;
        const n = Number(data.caja_fondo ?? 0);
        setGuardado(n);
        setValor(String(n));
      } catch {
        // Un fallo de lectura NO se pinta como "el fondo es 0": eso sería el
        // mismo defecto otra vez, ahora del lado de la pantalla.
        if (vivo) setError('No se pudo leer el fondo');
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  async function guardar(): Promise<void> {
    const resuelto = resolveFondo(valor);
    if (esFondoError(resuelto)) { setError(resuelto.error); setAviso(null); return; }

    setEnVuelo(true); setError(null); setAviso(null);
    try {
      const res = await fetch('/api/business/config', {
        method:      'PATCH',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify({ caja_fondo: resuelto }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'No se pudo guardar');
        return;
      }
      setGuardado(resuelto);
      setValor(String(resuelto));
      setAviso('Guardado');
    } catch {
      setError('No se pudo guardar. Revisa la conexión.');
    } finally {
      setEnVuelo(false);
    }
  }

  const sinCambios = guardado !== null && String(guardado) === valor.trim();

  return (
    <div className="rounded-xl bg-card px-4 py-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">
        Fondo de caja
      </p>
      <p className="mt-1 text-[15px] text-ink">
        El cambio con el que abre el cajón.
      </p>
      <p className="mt-0.5 text-[13px] text-ink-2">
        El corte cuenta todo lo que hay adentro, fondo incluido. Si acá dice un número
        que no es el tuyo, el descuadre de arriba sale corrido por esa diferencia.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={cargando ? '' : valor}
            disabled={cargando || enVuelo}
            onChange={(e) => { setValor(e.target.value); setError(null); setAviso(null); }}
            aria-label="Fondo de caja"
            className="w-36 rounded-lg border border-line bg-canvas py-2 pl-7 pr-3 text-sm tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-teal-ink disabled:opacity-50"
            placeholder={cargando ? '…' : '0'}
          />
        </div>
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={cargando || enVuelo || sinCambios}
          className="rounded-pill bg-teal px-4 py-2 text-sm font-bold text-card transition hover:opacity-90 disabled:opacity-40"
        >
          {enVuelo ? 'Guardando…' : 'Guardar'}
        </button>
        {aviso && <span className="text-sm text-teal-ink">{aviso}</span>}
      </div>

      {error && <p className="mt-2 text-sm text-amber" role="alert">{error}</p>}

      {/* Que el cambio NO reescriba el pasado es la mitad del valor de esta card:
          cada corte firmado guarda su `fondo_snapshot`, que es la diferencia
          entre un corte y un reporte. */}
      {guardado !== null && (
        <p className="mt-2 text-[11px] text-faint">
          Rige de aquí en adelante. Los cortes ya firmados guardan el fondo que tenían
          ese día{guardado > 0 ? ` (hoy: ${fmtMonto(guardado)})` : ''}.
        </p>
      )}
    </div>
  );
}
