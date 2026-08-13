// ─── CobroFields — monto + riel, el par que se captura al cobrar (D2) ─────────
// Presentacional y controlado: no valida (eso es `lib/cobro.ts`, que corre en el
// server) y no llama a ninguna action. Lo comparten la ficha del barbero y la
// mesa del asistente para que el gesto sea el MISMO en las dos superficies —
// duplicarlo garantizaría que se separen a la primera corrección.
//
// El monto arranca VACÍO con el precio de lista como placeholder, no
// pre-llenado: un campo lleno invita a confirmarlo sin mirar, y un monto
// "confirmado" que nadie tecleó es exactamente el dato que la capa de dinero no
// quiere. Vacío = no lo editaron = lo sella el trigger con la lista.

'use client';

import { RAILS, type Rail } from '@/lib/cobro';

const RAIL_LABEL: Record<Rail, string> = {
  efectivo:      'Efectivo',
  tarjeta:       'Tarjeta',
  transferencia: 'Transfer.',
};

export function railLabel(r: Rail): string {
  return RAIL_LABEL[r];
}

/** "$200 · Efectivo" — el texto del chip y del resumen. */
export function cobroResumen(amount: string, listPrice: number, method: Rail): string {
  const monto = amount.trim() === '' ? listPrice : Number(amount.replace(/[$,\s]/g, ''));
  const n = Number.isFinite(monto) ? monto : listPrice;
  return `$${n.toLocaleString('es-MX')} · ${RAIL_LABEL[method]}`;
}

export default function CobroFields({
  amount, method, listPrice, onAmount, onMethod, disabled,
}: {
  amount:    string;
  method:    Rail;
  listPrice: number;
  onAmount:  (v: string) => void;
  onMethod:  (m: Rail) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">Cuánto entró</span>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2.5">
          <span className="text-sm text-faint">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            disabled={disabled}
            onChange={(e) => onAmount(e.target.value)}
            placeholder={String(listPrice)}
            aria-label="Monto cobrado"
            className="w-full bg-transparent text-base tabular-nums text-ink outline-none placeholder:text-faint"
          />
        </div>
        <span className="mt-1 block text-xs text-faint">
          Déjalo vacío si cobraste el precio de siempre.
        </span>
      </label>

      <div>
        <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">Cómo pagó</span>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {RAILS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={disabled}
              onClick={() => onMethod(r)}
              aria-pressed={method === r}
              className={`min-h-[44px] rounded-xl border text-sm font-semibold disabled:opacity-50 ${
                method === r
                  ? 'border-teal-border bg-tint-1 text-teal-ink'
                  : 'border-line bg-card text-ink-2'
              }`}
            >
              {RAIL_LABEL[r]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
