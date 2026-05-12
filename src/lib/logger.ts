// Minimal logger. Console-only for v1.

type LogMeta = Record<string, unknown> | undefined;

export function logInfo(scope: string, message: string, meta?: LogMeta) {
  console.log(`[${scope}] ${message}`, meta ?? '');
}

export function logError(error: unknown, scope: string, meta?: LogMeta) {
  const err = error instanceof Error ? { message: error.message, stack: error.stack } : { value: error };
  console.error(`[${scope}]`, err, meta ?? '');
}
