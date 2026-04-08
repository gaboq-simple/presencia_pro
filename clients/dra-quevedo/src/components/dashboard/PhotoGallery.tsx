'use client';

// ─── PhotoGallery ──────────────────────────────────────────────────────────────
// Before/after photo gallery for a patient's treatment history.
// Rendered inside PatientHistoryDrawer, below the appointment timeline.
// Exclusive to the `medical` profile.
//
// Features:
//   - Groups photos by appointment with a date header
//   - 2-column grid: Antes (left) · Después (right)
//   - Client-side compression to ≤ 1200px before upload (canvas, no libraries)
//   - Hidden <input type="file" capture="environment"> for camera/gallery access
//   - Tap on photo → fullscreen modal
//   - Delete with inline confirmation
//   - URLs are signed — never public
//
// Data flow:
//   mount → GET /api/patients/[patientId]/photos
//   + tap → compressImage() → POST /api/patients/[patientId]/photos
//   delete tap → confirm → DELETE /api/patients/[patientId]/photos/[photoId]

import { useState, useEffect, useCallback, useRef } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Photo = {
  id: string;
  type: 'before' | 'after';
  url: string;
  notes: string | null;
  createdAt: string;
};

type PhotoGroup = {
  appointmentId: string;
  photos: Photo[];
};

type AppointmentRef = {
  id: string;
  serviceName: string;
  startsAt: string; // ISO
};

type Props = {
  readonly patientId: string;
  readonly timezone: string;
  /** All appointments from the patient history — used for group headers. */
  readonly appointments: readonly AppointmentRef[];
};

type PendingUpload = {
  appointmentId: string;
  type: 'before' | 'after';
};

// ─── Image compression ─────────────────────────────────────────────────────────

const MAX_WIDTH_PX = 1200;
const JPEG_QUALITY = 0.82;

/**
 * Reads a File, draws it on a canvas at ≤ MAX_WIDTH_PX, and returns a JPEG
 * data URL. Pure browser — no external libraries.
 */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (readerEvent) => {
      const img = new Image();

      img.onload = () => {
        const scale   = Math.min(1, MAX_WIDTH_PX / img.width);
        const canvas  = document.createElement('canvas');
        canvas.width  = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas context unavailable')); return; }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };

      img.onerror = () => reject(new Error('Image load failed'));
      img.src = readerEvent.target?.result as string;
    };

    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatGroupDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: timezone,
  });
}

// ─── PhotoModal ────────────────────────────────────────────────────────────────

function PhotoModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.92)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Foto del paciente"
        style={{ maxWidth: '95vw', maxHeight: '92dvh', objectFit: 'contain', borderRadius: '0.25rem' }}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        aria-label="Cerrar foto"
        style={{
          position: 'absolute', top: '1rem', right: '1rem',
          background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
          width: '2.25rem', height: '2.25rem', cursor: 'pointer',
          fontSize: '1rem', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── PhotoCell ─────────────────────────────────────────────────────────────────

type PhotoCellProps = {
  label: string;
  photo: Photo | undefined;
  uploading: boolean;
  onAddClick: () => void;
  onPhotoClick: (url: string) => void;
  onDeleteClick: (photoId: string) => void;
  deletingId: string | null;
};

function PhotoCell({
  label, photo, uploading, onAddClick, onPhotoClick, onDeleteClick, deletingId,
}: PhotoCellProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const cellStyle: React.CSSProperties = {
    position: 'relative',
    aspectRatio: '1',
    borderRadius: '0.375rem',
    overflow: 'hidden',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // ── Has photo ──────────────────────────────────────────────────────────────
  if (photo) {
    const isDeleting = deletingId === photo.id;
    return (
      <div style={cellStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={`Foto ${label.toLowerCase()}`}
          onClick={() => !confirmDelete && onPhotoClick(photo.url)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: confirmDelete ? 'default' : 'zoom-in' }}
        />

        {/* Label badge */}
        <span style={{
          position: 'absolute', top: '0.25rem', left: '0.25rem',
          fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff',
          padding: '0.125rem 0.3125rem', borderRadius: '0.2rem',
        }}>
          {label}
        </span>

        {/* Delete button / confirm */}
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            aria-label={`Eliminar foto ${label}`}
            style={{
              position: 'absolute', top: '0.25rem', right: '0.25rem',
              background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
              width: '1.375rem', height: '1.375rem', cursor: 'pointer',
              fontSize: '0.625rem', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        ) : (
          <div style={{
            position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
          }}>
            <p style={{ margin: 0, fontSize: '0.6875rem', color: '#fff', textAlign: 'center', padding: '0 0.5rem' }}>
              ¿Eliminar?
            </p>
            <div style={{ display: 'flex', gap: '0.375rem' }}>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{ padding: '0.25rem 0.5rem', background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '0.2rem', fontSize: '0.6875rem', color: '#fff', cursor: 'pointer' }}
              >
                No
              </button>
              <button
                onClick={() => { setConfirmDelete(false); onDeleteClick(photo.id); }}
                disabled={isDeleting}
                style={{ padding: '0.25rem 0.5rem', backgroundColor: '#DC2626', border: 'none', borderRadius: '0.2rem', fontSize: '0.6875rem', color: '#fff', cursor: isDeleting ? 'not-allowed' : 'pointer', fontWeight: 600 }}
              >
                {isDeleting ? '…' : 'Sí'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Empty cell (+ button) ─────────────────────────────────────────────────
  return (
    <div style={cellStyle}>
      <span style={{
        position: 'absolute', top: '0.25rem', left: '0.25rem',
        fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--color-ink-muted)',
      }}>
        {label}
      </span>
      <button
        onClick={onAddClick}
        disabled={uploading}
        aria-label={`Agregar foto ${label}`}
        style={{
          background: 'none', border: 'none', cursor: uploading ? 'not-allowed' : 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem',
          color: 'var(--color-ink-muted)',
        }}
      >
        <span style={{ fontSize: uploading ? '0.875rem' : '1.5rem', lineHeight: 1 }}>
          {uploading ? '…' : '+'}
        </span>
        {!uploading && (
          <span style={{ fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Subir
          </span>
        )}
      </button>
    </div>
  );
}

// ─── PhotoGallery ──────────────────────────────────────────────────────────────

export function PhotoGallery({ patientId, timezone, appointments }: Props) {
  const [groups, setGroups]           = useState<PhotoGroup[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [modalUrl, setModalUrl]       = useState<string | null>(null);
  const [uploading, setUploading]     = useState<PendingUpload | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Hidden file input — single instance, context tracked via `uploading` state
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Auth helper ───────────────────────────────────────────────────────────

  const getAuthHeader = useCallback(async (): Promise<string> => {
    const supabase = createSupabaseBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session ? `Bearer ${session.access_token}` : '';
  }, []);

  // ── Fetch photos ─────────────────────────────────────────────────────────

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuthHeader();
      const res  = await fetch(`/api/patients/${patientId}/photos`, { headers: { Authorization: auth } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { groups: PhotoGroup[] };
      setGroups(body.groups);
    } catch (err) {
      setError('No se pudieron cargar las fotos.');
    } finally {
      setLoading(false);
    }
  }, [patientId, getAuthHeader]);

  useEffect(() => { void fetchPhotos(); }, [fetchPhotos]);

  // ── Handle file selected ──────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploading) return;

    // Reset input so the same file can be re-selected if needed
    e.target.value = '';

    setUploadError(null);

    try {
      const imageDataUrl = await compressImage(file);
      const auth = await getAuthHeader();

      const res = await fetch(`/api/patients/${patientId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({
          appointmentId: uploading.appointmentId,
          type:          uploading.type,
          imageDataUrl,
        }),
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const body = await res.json() as { photoId: string; url: string };

      // Optimistic update
      const newPhoto: Photo = {
        id:        body.photoId,
        type:      uploading.type,
        url:       body.url,
        notes:     null,
        createdAt: new Date().toISOString(),
      };

      setGroups((prev) => {
        const existing = prev.find((g) => g.appointmentId === uploading.appointmentId);
        if (existing) {
          return prev.map((g) =>
            g.appointmentId === uploading.appointmentId
              ? { ...g, photos: [...g.photos, newPhoto] }
              : g,
          );
        }
        return [...prev, { appointmentId: uploading.appointmentId, photos: [newPhoto] }];
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Error al subir la foto');
    } finally {
      setUploading(null);
    }
  }

  // ── Handle delete ─────────────────────────────────────────────────────────

  async function handleDelete(photoId: string) {
    setDeletingId(photoId);
    try {
      const auth = await getAuthHeader();
      const res  = await fetch(`/api/patients/${patientId}/photos/${photoId}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Remove from state
      setGroups((prev) =>
        prev
          .map((g) => ({ ...g, photos: g.photos.filter((p) => p.id !== photoId) }))
          .filter((g) => g.photos.length > 0),
      );
    } catch {
      // Non-critical — the photo will still show. User can retry.
    } finally {
      setDeletingId(null);
    }
  }

  // ── Trigger file picker ───────────────────────────────────────────────────

  function triggerUpload(appointmentId: string, type: 'before' | 'after') {
    setUploading({ appointmentId, type });
    // Defer to next tick so state is set before input opens
    setTimeout(() => fileInputRef.current?.click(), 0);
  }

  // ── Build photo lookup ────────────────────────────────────────────────────

  function getPhoto(appointmentId: string, type: 'before' | 'after'): Photo | undefined {
    const group = groups.find((g) => g.appointmentId === appointmentId);
    return group?.photos.find((p) => p.type === type);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Only show appointments that have photos OR are among the 3 most recent
  const recentIds = new Set(appointments.slice(0, 3).map((a) => a.id));
  const photoApptIds = new Set(groups.map((g) => g.appointmentId));
  const visibleAppointments = appointments.filter(
    (a) => recentIds.has(a.id) || photoApptIds.has(a.id),
  );

  return (
    <div>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-muted)' }}>
        Fotos antes / después
      </p>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {uploadError && (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: '#991B1B' }}>⚠ {uploadError}</p>
      )}

      {loading ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-ink-muted)' }}>Cargando fotos…</p>
      ) : error ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#991B1B' }}>⚠ {error}</p>
      ) : visibleAppointments.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-ink-muted)' }}>Sin citas registradas.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {visibleAppointments.map((appt) => {
            const isUploadingBefore = uploading?.appointmentId === appt.id && uploading.type === 'before';
            const isUploadingAfter  = uploading?.appointmentId === appt.id && uploading.type === 'after';

            return (
              <div key={appt.id}>
                {/* Appointment header */}
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: 'var(--color-ink-muted)', fontWeight: 500 }}>
                  {appt.serviceName} · {formatGroupDate(appt.startsAt, timezone)}
                </p>

                {/* 2-column grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <PhotoCell
                    label="Antes"
                    photo={getPhoto(appt.id, 'before')}
                    uploading={isUploadingBefore}
                    onAddClick={() => triggerUpload(appt.id, 'before')}
                    onPhotoClick={setModalUrl}
                    onDeleteClick={handleDelete}
                    deletingId={deletingId}
                  />
                  <PhotoCell
                    label="Después"
                    photo={getPhoto(appt.id, 'after')}
                    uploading={isUploadingAfter}
                    onAddClick={() => triggerUpload(appt.id, 'after')}
                    onPhotoClick={setModalUrl}
                    onDeleteClick={handleDelete}
                    deletingId={deletingId}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fullscreen photo modal */}
      {modalUrl && <PhotoModal url={modalUrl} onClose={() => setModalUrl(null)} />}
    </div>
  );
}
