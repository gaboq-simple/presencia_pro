'use client';

// ─── IntakeForm — Client Component ────────────────────────────────────────────
// Renders the intake form with inline validation and an HTML5 canvas signature.
// Works on iOS and Android touch screens. No external canvas library needed.
// Designed for fast fill: < 3 minutes on mobile 4G.

import { useRef, useState, useCallback, useEffect } from 'react';
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import type { IntakeField } from '@presenciapro/engine/intake';

// ─── Types ────────────────────────────────────────────────────────────────────

type FormValues = Record<string, string>;
type FormErrors = Record<string, string>;

type IntakeFormProps = {
  readonly token: string;
  readonly fields: IntakeField[];
  readonly requiresSignature: boolean;
  readonly signatureLabel: string;
  readonly privacyUrl: string;
  readonly primaryColor: string;
};

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

// ─── Canvas signature hook ────────────────────────────────────────────────────

function useSignatureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const isEmpty = useRef(true);

  const getPos = useCallback(
    (e: MouseEvent | Touch): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  const startDrawingMouse = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      isDrawing.current = true;
      isEmpty.current = false;
      const pos = getPos(e.nativeEvent);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    },
    [getPos],
  );

  const startDrawingTouch = useCallback(
    (e: ReactTouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      isDrawing.current = true;
      isEmpty.current = false;
      const pos = getPos(e.touches[0]!);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    },
    [getPos],
  );

  const drawMouse = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!isDrawing.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pos = getPos(e.nativeEvent);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    },
    [getPos],
  );

  const drawTouch = useCallback(
    (e: ReactTouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!isDrawing.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pos = getPos(e.touches[0]!);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    },
    [getPos],
  );

  const stopDrawing = useCallback(() => {
    isDrawing.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    isEmpty.current = true;
  }, []);

  const getDataUrl = useCallback((): string | null => {
    if (isEmpty.current) return null;
    return canvasRef.current?.toDataURL('image/png') ?? null;
  }, []);

  // Initialize canvas context
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  return {
    canvasRef,
    startDrawingMouse,
    startDrawingTouch,
    drawMouse,
    drawTouch,
    stopDrawing,
    clearCanvas,
    getDataUrl,
    isEmpty,
  };
}

// ─── Field renderer ───────────────────────────────────────────────────────────

function FieldInput({
  field,
  value,
  error,
  primaryColor,
  onChange,
  onBlur,
}: {
  field: IntakeField;
  value: string;
  error: string | undefined;
  primaryColor: string;
  onChange: (id: string, value: string) => void;
  onBlur: (id: string) => void;
}) {
  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    marginBottom: '0.375rem',
    color: field.sensitive ? primaryColor : 'var(--color-ink)',
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.625rem 0.75rem',
    border: `1px solid ${error ? '#B91C1C' : 'var(--color-border)'}`,
    borderRadius: '0.375rem',
    fontSize: '1rem',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-ink)',
    outline: 'none',
    WebkitAppearance: 'none',
  };

  const errorStyle: CSSProperties = {
    marginTop: '0.25rem',
    fontSize: '0.8125rem',
    color: '#B91C1C',
  };

  const label = (
    <label htmlFor={field.id} style={labelStyle}>
      {field.label}
      {field.required && (
        <span
          aria-hidden="true"
          style={{ color: primaryColor, marginLeft: '0.25rem' }}
        >
          *
        </span>
      )}
      {field.sensitive && (
        <span
          style={{
            marginLeft: '0.5rem',
            fontSize: '0.75rem',
            fontWeight: 400,
            color: primaryColor,
          }}
        >
          (información médica)
        </span>
      )}
    </label>
  );

  if (field.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          id={field.id}
          value={value}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', minHeight: '5rem' }}
          onChange={(e) => onChange(field.id, e.target.value)}
          onBlur={() => onBlur(field.id)}
        />
        {error && <p style={errorStyle}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        id={field.id}
        type={field.type === 'date' ? 'date' : 'text'}
        value={value}
        style={inputStyle}
        onChange={(e) => onChange(field.id, e.target.value)}
        onBlur={() => onBlur(field.id)}
      />
      {error && <p style={errorStyle}>{error}</p>}
    </div>
  );
}

// ─── IntakeForm ───────────────────────────────────────────────────────────────

export function IntakeForm({
  token,
  fields,
  requiresSignature,
  signatureLabel,
  privacyUrl,
  primaryColor,
}: IntakeFormProps) {
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(fields.map((f) => [f.id, ''])),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [consentChecked, setConsentChecked] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const {
    canvasRef,
    startDrawingMouse,
    startDrawingTouch,
    drawMouse,
    drawTouch,
    stopDrawing,
    clearCanvas,
    getDataUrl,
    isEmpty,
  } = useSignatureCanvas();

  // ── Field validation ───────────────────────────────────────────────────────

  const validateField = useCallback(
    (id: string, value: string): string | null => {
      const field = fields.find((f) => f.id === id);
      if (!field) return null;
      if (field.required && !value.trim()) return 'Este campo es obligatorio';
      if (field.type === 'date' && value && isNaN(Date.parse(value))) {
        return 'Fecha inválida';
      }
      return null;
    },
    [fields],
  );

  const handleChange = useCallback((id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleBlur = useCallback(
    (id: string) => {
      const error = validateField(id, values[id] ?? '');
      setErrors((prev) => {
        if (!error) {
          const next = { ...prev };
          delete next[id];
          return next;
        }
        return { ...prev, [id]: error };
      });
    },
    [validateField, values],
  );

  // ── Full-form validation ───────────────────────────────────────────────────

  function validateAll(): boolean {
    const newErrors: FormErrors = {};
    for (const field of fields) {
      const error = validateField(field.id, values[field.id] ?? '');
      if (error) newErrors[field.id] = error;
    }
    setErrors(newErrors);

    let valid = Object.keys(newErrors).length === 0;

    if (requiresSignature && isEmpty.current) {
      setSignatureError('Por favor dibuja tu firma para continuar');
      valid = false;
    } else {
      setSignatureError(null);
    }

    if (!consentChecked) {
      setConsentError('Debes aceptar el aviso de privacidad para continuar');
      valid = false;
    } else {
      setConsentError(null);
    }

    return valid;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validateAll()) return;

    setSubmitState('submitting');

    const signatureDataUrl = requiresSignature ? (getDataUrl() ?? undefined) : undefined;

    try {
      const res = await fetch('/api/intake/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, fields: values, signatureDataUrl }),
      });

      if (!res.ok) {
        setSubmitState('error');
        return;
      }

      setSubmitState('success');
    } catch {
      setSubmitState('error');
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────

  if (submitState === 'success') {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
        <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✅</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.375rem',
            color: 'var(--color-ink)',
            marginBottom: '0.5rem',
          }}
        >
          ¡Formulario completado!
        </h2>
        <p style={{ color: 'var(--color-ink-muted)', fontSize: '1rem', lineHeight: 1.6 }}>
          Tus datos han sido guardados de forma segura.
          <br />
          Puedes cerrar esta ventana.
        </p>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
    >
      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={values[field.id] ?? ''}
          error={errors[field.id]}
          primaryColor={primaryColor}
          onChange={handleChange}
          onBlur={handleBlur}
        />
      ))}

      {requiresSignature && (
        <div>
          <p
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              marginBottom: '0.375rem',
              color: 'var(--color-ink)',
            }}
          >
            Firma digital{' '}
            <span aria-hidden="true" style={{ color: primaryColor }}>
              *
            </span>
          </p>
          <p
            style={{
              fontSize: '0.8125rem',
              color: 'var(--color-ink-muted)',
              marginBottom: '0.5rem',
            }}
          >
            Firma con tu dedo o mouse en el recuadro de abajo
          </p>
          <div
            style={{
              border: `1px solid ${signatureError ? '#B91C1C' : 'var(--color-border)'}`,
              borderRadius: '0.375rem',
              backgroundColor: '#ffffff',
              overflow: 'hidden',
              touchAction: 'none',
            }}
          >
            <canvas
              ref={canvasRef}
              width={800}
              height={160}
              style={{ display: 'block', width: '100%', height: '160px', cursor: 'crosshair' }}
              onMouseDown={startDrawingMouse}
              onMouseMove={drawMouse}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawingTouch}
              onTouchMove={drawTouch}
              onTouchEnd={stopDrawing}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.375rem' }}>
            <button
              type="button"
              onClick={clearCanvas}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8125rem',
                color: 'var(--color-ink-muted)',
                padding: '0.25rem 0',
                textDecoration: 'underline',
              }}
            >
              Limpiar
            </button>
          </div>
          {signatureError && (
            <p style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: '#B91C1C' }}>
              {signatureError}
            </p>
          )}
        </div>
      )}

      <div>
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.625rem',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => {
              setConsentChecked(e.target.checked);
              if (e.target.checked) setConsentError(null);
            }}
            style={{ marginTop: '0.125rem', flexShrink: 0, accentColor: primaryColor }}
          />
          <span style={{ fontSize: '0.9375rem', color: 'var(--color-ink)', lineHeight: 1.5 }}>
            {signatureLabel}{' '}
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: primaryColor }}
            >
              (leer aviso)
            </a>
          </span>
        </label>
        {consentError && (
          <p style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: '#B91C1C' }}>
            {consentError}
          </p>
        )}
      </div>

      {submitState === 'error' && (
        <div
          style={{
            padding: '0.75rem',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '0.375rem',
            color: '#B91C1C',
            fontSize: '0.9375rem',
          }}
        >
          Ocurrió un error al guardar tu formulario. Por favor intenta de nuevo — tus datos no se han perdido.
        </div>
      )}

      <button
        type="submit"
        disabled={submitState === 'submitting'}
        style={{
          padding: '0.875rem',
          backgroundColor: submitState === 'submitting' ? `${primaryColor}99` : primaryColor,
          color: '#fafaf8',
          border: 'none',
          borderRadius: '0.375rem',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: submitState === 'submitting' ? 'not-allowed' : 'pointer',
          letterSpacing: '0.01em',
        }}
      >
        {submitState === 'submitting' ? 'Guardando tu información…' : 'Firmar y enviar formulario'}
      </button>
    </form>
  );
}
