// ─── Retry utility ────────────────────────────────────────────────────────────
// withRetry: ejecuta fn hasta maxAttempts veces con backoff exponencial.
// Si todos los intentos fallan, lanza el último error.
// Sin dependencias externas — TypeScript nativo.

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 300,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)),
        );
      }
    }
  }

  throw lastError;
}
