'use client';

// ─── LeadForm ─────────────────────────────────────────────────────────────────
// Formulario de captura rápida de lead. Mobile-first, máx 30 segundos.
// Valida duplicado de teléfono onBlur antes de permitir submit.

import { useState, useRef } from 'react';
import { CreateLeadSchema } from '@presenciapro/engine/types';
import type { CreateLeadInput } from '@presenciapro/engine/types';

interface LeadFormProps {
  readonly sellerId: string;
  readonly onSuccess: () => void;
}

type FieldErrors = Partial<Record<keyof CreateLeadInput, string>>;

const EMPTY_FORM: CreateLeadInput = {
  doctor_name: '',
  doctor_phone: '',
  city: '',
  specialty: '',
  notes: '',
};

export default function LeadForm({ onSuccess }: LeadFormProps) {
  const [form, setForm] = useState<CreateLeadInput>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [phoneExists, setPhoneExists] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const lastCheckedPhone = useRef<string>('');

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));

    // Limpiar error del campo al escribir
    if (fieldErrors[name as keyof CreateLeadInput]) {
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    }

    // Si cambió el teléfono, resetear el estado de duplicado
    if (name === 'doctor_phone' && phoneExists) {
      setPhoneExists(false);
    }
  }

  async function handlePhoneBlur() {
    const phone = form.doctor_phone.trim();
    if (!phone || phone === lastCheckedPhone.current) return;

    lastCheckedPhone.current = phone;

    try {
      const res = await fetch(
        `/api/leads/check-phone?phone=${encodeURIComponent(phone)}`,
      );
      if (!res.ok) return;

      const data = (await res.json()) as { exists: boolean };
      setPhoneExists(data.exists);

      if (data.exists) {
        setFieldErrors((prev) => ({
          ...prev,
          doctor_phone: 'Este número ya fue registrado',
        }));
      }
    } catch {
      // Error de red — no bloqueamos el submit
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    // Validación Zod en el cliente
    const parsed = CreateLeadSchema.safeParse({
      ...form,
      specialty: form.specialty || undefined,
      notes: form.notes || undefined,
    });

    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      const errors: FieldErrors = {};
      (Object.keys(flat) as Array<keyof CreateLeadInput>).forEach((key) => {
        const msgs = flat[key];
        if (msgs && msgs.length > 0) errors[key] = msgs[0];
      });
      setFieldErrors(errors);
      return;
    }

    if (phoneExists) return;

    setSubmitting(true);

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (res.status === 409) {
        setFieldErrors((prev) => ({
          ...prev,
          doctor_phone: 'Este número ya fue registrado por otro vendedor',
        }));
        setPhoneExists(true);
        return;
      }

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setServerError(body.error ?? 'Error al registrar el prospecto');
        return;
      }

      setForm(EMPTY_FORM);
      setFieldErrors({});
      setPhoneExists(false);
      lastCheckedPhone.current = '';
      onSuccess();
    } catch {
      setServerError('Error de red. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !submitting && !phoneExists;

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <h2 className="mb-4 text-base font-semibold text-gray-800">
        Registrar prospecto
      </h2>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* doctor_name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Nombre del doctor
          </label>
          <input
            type="text"
            name="doctor_name"
            value={form.doctor_name}
            onChange={handleChange}
            placeholder="Dra. Ana Torres"
            autoComplete="off"
            className={inputClass(!!fieldErrors.doctor_name)}
          />
          {fieldErrors.doctor_name && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.doctor_name}</p>
          )}
        </div>

        {/* doctor_phone */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Teléfono
          </label>
          <input
            type="tel"
            name="doctor_phone"
            value={form.doctor_phone}
            onChange={handleChange}
            onBlur={handlePhoneBlur}
            placeholder="+52 55 1234 5678"
            autoComplete="off"
            className={inputClass(!!fieldErrors.doctor_phone)}
          />
          {fieldErrors.doctor_phone && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.doctor_phone}</p>
          )}
        </div>

        {/* city */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Ciudad
          </label>
          <input
            type="text"
            name="city"
            value={form.city}
            onChange={handleChange}
            placeholder="CDMX, Guadalajara..."
            autoComplete="off"
            className={inputClass(!!fieldErrors.city)}
          />
          {fieldErrors.city && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.city}</p>
          )}
        </div>

        {/* specialty — opcional */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Especialidad{' '}
            <span className="font-normal text-gray-400">(opcional)</span>
          </label>
          <input
            type="text"
            name="specialty"
            value={form.specialty ?? ''}
            onChange={handleChange}
            placeholder="Dermatología, Psicología..."
            autoComplete="off"
            className={inputClass(false)}
          />
        </div>

        {/* notes — opcional */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Notas{' '}
            <span className="font-normal text-gray-400">(opcional)</span>
          </label>
          <textarea
            name="notes"
            value={form.notes ?? ''}
            onChange={handleChange}
            placeholder="Interesada en botox, llama el lunes"
            rows={3}
            className={`${inputClass(false)} resize-none`}
          />
        </div>

        {serverError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Spinner />
              Registrando...
            </>
          ) : (
            'Registrar prospecto'
          )}
        </button>
      </form>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-lg border px-4 py-3 text-base text-gray-900 placeholder-gray-400',
    'focus:outline-none focus:ring-2 transition-colors',
    hasError
      ? 'border-red-400 focus:ring-red-300'
      : 'border-gray-300 focus:ring-indigo-300 focus:border-indigo-400',
  ].join(' ');
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
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
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
