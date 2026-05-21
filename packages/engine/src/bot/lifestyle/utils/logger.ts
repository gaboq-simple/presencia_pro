// ─── Logger helpers ────────────────────────────────────────────────────────────
// Utilidades para loguear errores del bot sin exponer PII.
// maskPhone: enmascara números de teléfono en cualquier string.
// logBotError: wrapper estructurado sobre console.error con masking automático.

/**
 * Reemplaza números de teléfono (formatos internacionales comunes) con `***PHONE***`.
 * Cubre: +521234567890, 521234567890, 1234567890 (7–15 dígitos).
 */
export function maskPhone(input: string): string {
  return input.replace(/\+?[1-9]\d{6,14}/g, '***PHONE***');
}

/**
 * Loguea un error del bot en formato JSON estructurado con PII enmascarada.
 */
export function logBotError(params: {
  context: string;
  error: unknown;
  businessId?: string;
  customerPhone?: string;
}): void {
  const raw = params.error instanceof Error
    ? params.error.message
    : String(params.error);

  console.error(JSON.stringify({
    ts:             new Date().toISOString(),
    service:        'engine',
    context:        params.context,
    business_id:    params.businessId,
    customer_phone: params.customerPhone ? maskPhone(params.customerPhone) : undefined,
    error_message:  maskPhone(raw),
  }));
}
