'use client';

import { useState } from 'react';

type RequestType = 'acceso' | 'rectificacion' | 'cancelacion' | 'oposicion';

const REQUEST_TYPES: { value: RequestType; label: string; hint: string }[] = [
  { value: 'acceso',        label: 'Acceso',        hint: 'Quiero saber qué datos tienen sobre mí' },
  { value: 'rectificacion', label: 'Rectificación',  hint: 'Quiero corregir datos inexactos' },
  { value: 'cancelacion',   label: 'Cancelación',    hint: 'Quiero que eliminen mis datos' },
  { value: 'oposicion',     label: 'Oposición',      hint: 'Quiero limitar el uso de mis datos' },
];

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export default function ArcoForm() {
  const [formState, setFormState] = useState<FormState>('idle');
  const [errorMsg,  setErrorMsg]  = useState<string>('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormState('submitting');
    setErrorMsg('');

    const form = e.currentTarget;
    const data = {
      customer_name:  (form.elements.namedItem('customer_name')  as HTMLInputElement).value.trim(),
      customer_phone: (form.elements.namedItem('customer_phone') as HTMLInputElement).value.trim(),
      customer_email: (form.elements.namedItem('customer_email') as HTMLInputElement).value.trim() || null,
      request_type:   (form.elements.namedItem('request_type')   as HTMLInputElement).value,
      description:    (form.elements.namedItem('description')    as HTMLTextAreaElement).value.trim(),
    };

    try {
      const res = await fetch('/api/arco', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      });

      if (res.status === 429) {
        setErrorMsg('Demasiadas solicitudes. Intenta de nuevo en una hora.');
        setFormState('error');
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg((body as { error?: string }).error ?? 'Ocurrió un error. Intenta de nuevo.');
        setFormState('error');
        return;
      }

      setFormState('success');
    } catch {
      setErrorMsg('Error de red. Verifica tu conexión e intenta de nuevo.');
      setFormState('error');
    }
  }

  if (formState === 'success') {
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center">
        <div className="w-12 h-12 bg-neutral-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-neutral-900 mb-2">
          Solicitud recibida
        </h2>
        <p className="text-sm text-neutral-600 leading-relaxed">
          Tu solicitud fue registrada. Te contactaremos en un máximo de{' '}
          <span className="font-medium text-neutral-800">20 días hábiles</span>{' '}
          al número o correo proporcionado.
        </p>
        <p className="mt-4 text-xs text-neutral-400">
          Si tienes dudas, escríbenos a{' '}
          <a href="mailto:contacto@zentriq.mx" className="text-neutral-600 hover:underline">
            contacto@zentriq.mx
          </a>
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-neutral-200 rounded-xl p-6 space-y-5"
    >
      {/* Nombre */}
      <div>
        <label htmlFor="customer_name" className="block text-sm font-medium text-neutral-700 mb-1">
          Nombre completo <span className="text-red-500">*</span>
        </label>
        <input
          id="customer_name"
          name="customer_name"
          type="text"
          required
          autoComplete="name"
          placeholder="Ej. María García López"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
        />
      </div>

      {/* Teléfono */}
      <div>
        <label htmlFor="customer_phone" className="block text-sm font-medium text-neutral-700 mb-1">
          Teléfono <span className="text-red-500">*</span>
        </label>
        <input
          id="customer_phone"
          name="customer_phone"
          type="tel"
          required
          autoComplete="tel"
          placeholder="Ej. 5512345678"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
        />
      </div>

      {/* Email opcional */}
      <div>
        <label htmlFor="customer_email" className="block text-sm font-medium text-neutral-700 mb-1">
          Correo electrónico <span className="text-neutral-400 font-normal">(opcional)</span>
        </label>
        <input
          id="customer_email"
          name="customer_email"
          type="email"
          autoComplete="email"
          placeholder="Ej. maria@correo.com"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
        />
      </div>

      {/* Tipo de solicitud */}
      <fieldset>
        <legend className="text-sm font-medium text-neutral-700 mb-2">
          Tipo de solicitud <span className="text-red-500">*</span>
        </legend>
        <div className="space-y-2">
          {REQUEST_TYPES.map(({ value, label, hint }) => (
            <label key={value} className="flex items-start gap-3 cursor-pointer group">
              <input
                type="radio"
                name="request_type"
                value={value}
                required
                className="mt-0.5 h-4 w-4 accent-neutral-900 cursor-pointer"
              />
              <span>
                <span className="text-sm font-medium text-neutral-800 group-hover:text-neutral-900">
                  {label}
                </span>
                <span className="block text-xs text-neutral-400">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Descripción */}
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-neutral-700 mb-1">
          Descripción de tu solicitud <span className="text-red-500">*</span>
        </label>
        <textarea
          id="description"
          name="description"
          required
          rows={4}
          placeholder="Describe brevemente qué información solicitas o qué acción necesitas..."
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 resize-none"
        />
      </div>

      {/* Checkbox aviso */}
      <div className="flex items-start gap-3">
        <input
          id="privacy_consent"
          name="privacy_consent"
          type="checkbox"
          required
          className="mt-0.5 h-4 w-4 accent-neutral-900 cursor-pointer"
        />
        <label htmlFor="privacy_consent" className="text-xs text-neutral-500 leading-relaxed cursor-pointer">
          He leído el{' '}
          <a
            href="/aviso-de-privacidad"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-700 hover:underline font-medium"
          >
            aviso de privacidad
          </a>{' '}
          y entiendo que mis datos se usarán para atender esta solicitud.
        </label>
      </div>

      {/* Error */}
      {formState === 'error' && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {errorMsg}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={formState === 'submitting'}
        className="w-full bg-neutral-900 text-white text-sm font-medium rounded-lg px-4 py-2.5 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {formState === 'submitting' ? 'Enviando…' : 'Enviar solicitud'}
      </button>
    </form>
  );
}
