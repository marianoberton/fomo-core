/**
 * Discriminated union for operations that can fail expectedly.
 * Forces callers to handle both success and failure paths.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Create a successful Result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Create a failed Result. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Type guard for successful Result. */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

/** Type guard for failed Result. */
export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/**
 * Unwrap a Result, throwing if it's an error.
 * Only use in tests or truly unrecoverable situations.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}
