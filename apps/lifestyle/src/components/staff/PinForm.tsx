// ─── PinForm ──────────────────────────────────────────────────────────────────
// Client Component — formulario de acceso por PIN para barberos.
//
// UX:
//   - 4 inputs individuales (uno por dígito) para facilitar entrada en móvil.
//   - Auto-focus al primer campo al montar.
//   - Auto-avanza al siguiente campo al escribir un dígito.
//   - Backspace en campo vacío → retrocede al campo anterior.
//   - Al completar los 4 dígitos → submit automático.
//   - Estado de carga + error visual.
//   - Al éxito: router.push('/staff') con refresh.

'use client';

import { useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ─── Component ────────────────────────────────────────────────────────────────

export default function PinForm() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null]);

  // ── Submit ──────────────────────────────────────────────────────────────────

  const submit = useCallback(async (pin: string) => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'PIN incorrecto');
        setDigits(['', '', '', '']);
        inputRefs.current[0]?.focus();
        return;
      }

      // PIN correcto — la cookie ya fue seteada por el server
      router.push('/staff');
      router.refresh();
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [loading, router]);

  // ── Manejo de inputs ────────────────────────────────────────────────────────

  function handleChange(index: number, value: string) {
    // Solo dígitos
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setError(null);

    if (digit) {
      // Avanzar al siguiente campo
      if (index < 3) {
        inputRefs.current[index + 1]?.focus();
      } else {
        // Último dígito — submit automático si los 4 están completos
        const pin = newDigits.join('');
        if (pin.length === 4) {
          void submit(pin);
        }
      }
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      // Retroceder al campo anterior
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!text) return;

    const newDigits = ['', '', '', ''];
    for (let i = 0; i < text.length; i++) {
      newDigits[i] = text[i] ?? '';
    }
    setDigits(newDigits);
    setError(null);

    const nextEmpty = newDigits.findIndex((d) => d === '');
    const focusIndex = nextEmpty === -1 ? 3 : nextEmpty;
    inputRefs.current[focusIndex]?.focus();

    if (text.length === 4) {
      void submit(text);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white px-6 py-8 shadow-sm border border-gray-100">

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-900">
            {/* Tijeras / barbería */}
            <svg
              className="h-6 w-6 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 11-5.196-3 3 3 0 015.196 3zm1.536.887a2.165 2.165 0 011.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 4.092m0 0l.923 1.817M9.384 9.137L7.848 8.25m4.535 5.046l1.538-.887m-1.538.887a3 3 0 105.194 3 3 3 0 00-5.194-3zm1.538-.887l-2.077-4.092m0 0l-.923-1.817M14.616 14.183L16.152 15.75M14.616 14.183L12.54 10.09m0 0l.923-1.817m-1.846 0l.923 1.817"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Acceso barbero</h1>
          <p className="mt-1 text-sm text-gray-500">Ingresa tu PIN de 4 digitos</p>
        </div>

        {/* PIN inputs */}
        <div
          className="flex justify-center gap-3"
          onPaste={handlePaste}
          aria-label="PIN de acceso"
        >
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { inputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              pattern="\d*"
              maxLength={1}
              value={digit}
              autoFocus={index === 0}
              disabled={loading}
              aria-label={`Digito ${index + 1}`}
              onChange={(e) => handleChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              className={`h-14 w-14 rounded-xl border-2 text-center text-2xl font-bold tabular-nums transition-colors
                focus:outline-none
                ${loading ? 'cursor-not-allowed opacity-50' : ''}
                ${error
                  ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-400'
                  : digit
                  ? 'border-gray-900 bg-gray-900 text-white focus:border-gray-900'
                  : 'border-gray-200 bg-gray-50 text-gray-900 focus:border-gray-400'
                }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <p className="mt-4 text-center text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* Cargando */}
        {loading && (
          <p className="mt-4 text-center text-sm text-gray-400">
            Verificando...
          </p>
        )}

      </div>
    </main>
  );
}
