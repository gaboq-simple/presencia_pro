'use client';

// ─── StaffPhotoManager ─────────────────────────────────────────────────────────
// Client Component — gestión de fotos del equipo desde el dashboard admin.
//
// Por cada barbero activo:
//   - Si tiene photo_url: foto + botones "Cambiar" y "Eliminar"
//   - Si no tiene foto: área drag & drop / click para seleccionar
//
// Flujo de upload:
//   1. Selección de archivo (drag & drop o click)
//   2. Validación cliente: MIME + tamaño
//   3. Preview inmediato via FileReader
//   4. Confirmar → POST /api/staff/{id}/photo
//   5. Actualización de estado sin reload
//
// El cliente NUNCA sube directo a Storage — siempre via API route.

import { useState, useCallback } from 'react';
import Image from 'next/image';
import type { AdminStaffPhotoRow } from '@/lib/dashboard.types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

// ─── Tipos ────────────────────────────────────────────────────────────────────

type UploadState = {
  preview: string | null;   // FileReader data URL para preview
  file: File | null;        // archivo pendiente de subir
  uploading: boolean;
  error: string | null;
  dragOver: boolean;
};

type StaffPhotoState = Map<string, UploadState>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) {
    return 'Solo se permiten imágenes JPEG, PNG o WebP.';
  }
  if (file.size > MAX_SIZE_BYTES) {
    return 'El archivo es demasiado grande. Máximo 2MB.';
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

const DEFAULT_UPLOAD_STATE: UploadState = {
  preview: null,
  file: null,
  uploading: false,
  error: null,
  dragOver: false,
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  initialStaff: AdminStaffPhotoRow[];
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffPhotoManager({ initialStaff }: Props) {
  // Estado de las fotos actuales (se actualiza sin reload)
  const [staffList, setStaffList] = useState<AdminStaffPhotoRow[]>(initialStaff);

  // Estado de upload por staff id
  const [uploadStates, setUploadStates] = useState<StaffPhotoState>(new Map());

  // ─── Helpers de estado ──────────────────────────────────────────────────────

  function getUploadState(staffId: string): UploadState {
    return uploadStates.get(staffId) ?? DEFAULT_UPLOAD_STATE;
  }

  function setUploadStateForStaff(staffId: string, patch: Partial<UploadState>) {
    setUploadStates((prev) => {
      const next = new Map(prev);
      next.set(staffId, { ...(prev.get(staffId) ?? DEFAULT_UPLOAD_STATE), ...patch });
      return next;
    });
  }

  function clearUploadState(staffId: string) {
    setUploadStates((prev) => {
      const next = new Map(prev);
      next.delete(staffId);
      return next;
    });
  }

  // ─── Selección de archivo ────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (staffId: string, file: File | null) => {
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setUploadStateForStaff(staffId, { error: validationError, file: null, preview: null });
      return;
    }

    try {
      const preview = await readFileAsDataUrl(file);
      setUploadStateForStaff(staffId, { file, preview, error: null });
    } catch {
      setUploadStateForStaff(staffId, { error: 'No se pudo leer el archivo.', file: null, preview: null });
    }
  }, []);

  // ─── Drag & drop ─────────────────────────────────────────────────────────────

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, staffId: string) => {
      e.preventDefault();
      setUploadStateForStaff(staffId, { dragOver: true });
    },
    [],
  );

  const handleDragLeave = useCallback(
    (_e: React.DragEvent<HTMLDivElement>, staffId: string) => {
      setUploadStateForStaff(staffId, { dragOver: false });
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, staffId: string) => {
      e.preventDefault();
      setUploadStateForStaff(staffId, { dragOver: false });
      const file = e.dataTransfer.files[0] ?? null;
      void handleFileSelect(staffId, file);
    },
    [handleFileSelect],
  );

  // ─── Upload ──────────────────────────────────────────────────────────────────

  const handleUpload = useCallback(async (staffId: string) => {
    const state = uploadStates.get(staffId);
    if (!state?.file) return;

    setUploadStateForStaff(staffId, { uploading: true, error: null });

    const formData = new FormData();
    formData.append('file', state.file);

    try {
      const res = await fetch(`/api/staff/${staffId}/photo`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Error al subir la foto.');
      }

      const json = (await res.json()) as { photo_url: string };

      // Actualizar foto en la lista sin reload
      setStaffList((prev) =>
        prev.map((s) => (s.id === staffId ? { ...s, photo_url: json.photo_url } : s)),
      );
      clearUploadState(staffId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido.';
      setUploadStateForStaff(staffId, { uploading: false, error: message });
    }
  }, [uploadStates]);

  // ─── Eliminar foto ────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (staffId: string) => {
    setUploadStateForStaff(staffId, { uploading: true, error: null });

    try {
      const res = await fetch(`/api/staff/${staffId}/photo`, { method: 'DELETE' });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Error al eliminar la foto.');
      }

      setStaffList((prev) =>
        prev.map((s) => (s.id === staffId ? { ...s, photo_url: null } : s)),
      );
      clearUploadState(staffId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido.';
      setUploadStateForStaff(staffId, { uploading: false, error: message });
    }
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (staffList.length === 0) {
    return (
      <p className="text-sm text-gray-500">No hay staff activo registrado.</p>
    );
  }

  return (
    <ul className="space-y-4" style={{ listStyle: 'none', padding: 0 }}>
      {staffList.map((member) => {
        const state = getUploadState(member.id);
        const hasPhoto = Boolean(member.photo_url);
        const hasPending = Boolean(state.file && state.preview);

        return (
          <li
            key={member.id}
            className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4"
          >
            {/* ── Fila superior: avatar + nombre ── */}
            <div className="flex items-center gap-3">
              {/* Avatar: foto actual o preview o iniciales */}
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-gray-200">
                {hasPending && state.preview ? (
                  <Image
                    src={state.preview}
                    alt={`Preview ${member.name}`}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : hasPhoto && member.photo_url ? (
                  <Image
                    src={member.photo_url}
                    alt={member.name}
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-gray-500">
                    {getInitials(member.name)}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {member.name}
                </p>
                {hasPhoto && !hasPending && (
                  <p className="text-xs text-gray-400">Foto actual</p>
                )}
                {hasPending && (
                  <p className="text-xs text-gray-400">Preview — pendiente de subir</p>
                )}
                {!hasPhoto && !hasPending && (
                  <p className="text-xs text-gray-400">Sin foto</p>
                )}
              </div>

              {/* Botones cuando hay foto y no hay upload pendiente */}
              {hasPhoto && !hasPending && !state.uploading && (
                <div className="flex shrink-0 gap-2">
                  <label
                    htmlFor={`photo-input-${member.id}`}
                    className="cursor-pointer rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Cambiar
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleDelete(member.id)}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </div>

            {/* Input de archivo (siempre oculto, accesible via label) */}
            <input
              id={`photo-input-${member.id}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => void handleFileSelect(member.id, e.target.files?.[0] ?? null)}
            />

            {/* ── Área de drop — solo visible cuando no hay foto ni preview ── */}
            {!hasPhoto && !hasPending && (
              <div
                onDragOver={(e) => handleDragOver(e, member.id)}
                onDragLeave={(e) => handleDragLeave(e, member.id)}
                onDrop={(e) => handleDrop(e, member.id)}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
                  state.dragOver
                    ? 'border-gray-400 bg-gray-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <label
                  htmlFor={`photo-input-${member.id}`}
                  className="cursor-pointer text-sm text-gray-500 hover:text-gray-700"
                >
                  Arrastra una imagen aquí o{' '}
                  <span className="font-medium text-gray-700 underline underline-offset-2">
                    selecciona un archivo
                  </span>
                </label>
                <p className="text-xs text-gray-400">JPEG, PNG o WebP · máx 2MB</p>
              </div>
            )}

            {/* ── Botones de confirmación cuando hay preview pendiente ── */}
            {hasPending && !state.uploading && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleUpload(member.id)}
                  className="flex-1 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                >
                  Subir foto
                </button>
                <button
                  type="button"
                  onClick={() => clearUploadState(member.id)}
                  className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* ── Indicador de progreso ── */}
            {state.uploading && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <svg
                  className="h-4 w-4 animate-spin text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"
                  />
                </svg>
                Subiendo…
              </div>
            )}

            {/* ── Error ── */}
            {state.error && (
              <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">
                {state.error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
