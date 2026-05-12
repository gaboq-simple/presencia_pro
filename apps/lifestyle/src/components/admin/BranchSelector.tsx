'use client';

// ─── BranchSelector ───────────────────────────────────────────────────────────
// Selector de sucursal para sesiones de organización (multi-sucursal).
// Mobile-first — dropdown nativo para compatibilidad máxima en móvil.
//
// Props:
//   branches        — lista de sucursales disponibles para el dueño
//   currentBranchId — sucursal actualmente seleccionada, o 'all' para consolidado
//
// Al cambiar, navega a /dashboard?branch=<id|all> preservando ?date= si existe.
// La opción "Todas las sucursales" (value='all') aparece siempre como primera opción.

import { useRouter, useSearchParams } from 'next/navigation';

type Branch = {
  id: string;
  name: string;
};

type Props = {
  branches: Branch[];
  /** UUID de la sucursal activa, o 'all' para la vista consolidada */
  currentBranchId: string;
};

export default function BranchSelector({ branches, currentBranchId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const branchId = e.target.value;
    const params = new URLSearchParams();
    params.set('branch', branchId);
    // Preservar ?date si está presente (ignorar en vista 'all' — no hay nav de días)
    if (branchId !== 'all') {
      const date = searchParams.get('date');
      if (date) params.set('date', date);
    }
    router.push(`/dashboard?${params.toString()}`);
  }

  return (
    <select
      value={currentBranchId}
      onChange={handleChange}
      aria-label="Seleccionar sucursal"
      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
      style={{ maxWidth: '180px' }}
    >
      <option value="all">Todas las sucursales</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
