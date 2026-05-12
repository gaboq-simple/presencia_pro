'use client';

// ─── DashboardHeader ─────────────────────────────────────────────────────────
// Muestra nombre del vendedor, mes/año actual y botón de cierre de sesión.

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;

interface DashboardHeaderProps {
  readonly sellerName: string;
}

export default function DashboardHeader({ sellerName }: DashboardHeaderProps) {
  const now = new Date();
  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{sellerName}</h1>
        <p className="text-sm text-gray-500">{monthLabel}</p>
      </div>
      <form action="/api/auth/logout" method="POST">
        <button
          type="submit"
          className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          Cerrar sesión
        </button>
      </form>
    </header>
  );
}
