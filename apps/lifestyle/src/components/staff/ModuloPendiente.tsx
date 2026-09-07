// ─── ModuloPendiente — el slot declarado que todavía no tiene módulo ──────────
// Client Component. Existe por la decisión de Gabriel del 2026-09-06: los cuatro
// slots de la barra se declaran desde M1 aunque uno se encienda en M6, porque una
// barra que crece de 2 a 4 mueve el piso bajo el pulgar de alguien que ya aprendió
// dónde tocar.
//
// POR QUÉ UN ESTADO VACÍO Y NO UN BOTÓN `disabled`. Esta misma ola le diagnostica
// a "Buscar cliente" (`AssistantControlDesk.tsx`) el defecto de llevar meses
// apagado con el tooltip "Disponible en la próxima iteración": un control apagado
// no enseña nada y no se puede planear contra él. Un estado vacío que NOMBRA lo
// que va a vivir ahí es información. La diferencia práctica es que este texto se
// borra el día que el módulo llega, y ese día está escrito.
//
// Este archivo se BORRA en M6. Si sigue existiendo después, es que M6 no se hizo.

'use client';

type Props = {
  titulo: string;
  /** Qué va a vivir acá. En prosa corta, sin promesas de fecha. */
  descripcion: string;
  /** Dónde se hace hoy lo que este módulo va a hacer mañana. */
  mientrasTanto?: string;
};

export default function ModuloPendiente({
  titulo,
  descripcion,
  mientrasTanto,
}: Props): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-card border border-line bg-card p-8 text-center shadow-card">
      <div className="max-w-sm">
        <h2 className="text-base font-semibold text-ink">{titulo}</h2>
        <p className="mt-2 text-sm text-ink-2">{descripcion}</p>
        {mientrasTanto && (
          <p className="mt-4 border-t border-line pt-4 text-xs text-faint">{mientrasTanto}</p>
        )}
      </div>
    </div>
  );
}
