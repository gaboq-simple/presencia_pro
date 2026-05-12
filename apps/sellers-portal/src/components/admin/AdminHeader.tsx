// ─── AdminHeader ──────────────────────────────────────────────────────────────
// Server Component. Título del portal, nombre del operador, cierre de sesión.

interface AdminHeaderProps {
  readonly operatorName: string;
}

export default function AdminHeader({ operatorName }: AdminHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">PresenciaPro Admin</h1>
        <p className="text-sm text-gray-500">{operatorName}</p>
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
