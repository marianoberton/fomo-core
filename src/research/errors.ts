/**
 * Research-module-specific errors.
 *
 * Extends the shared `NexusError` class so they integrate with the
 * existing error handler at `src/api/error-handler.ts`.
 *
 * Use `Result<T, ResearchError>` (from `src/core/result.ts`) at module
 * boundaries for expected failures. Reserve `throw` for invariant
 * violations that should crash the request.
 */
import { NexusError } from '@/core/errors.js';

export type ResearchErrorCode =
  /** WAHA HTTP request failed after retries (network, 5xx). */
  | 'WAHA_UNREACHABLE'
  /** WAHA reports the session is not in WORKING state. */
  | 'WAHA_SESSION_NOT_WORKING'
  /** Phone is rate-limited (daily volume / per-target / per-day). */
  | 'PHONE_RATE_LIMITED'
  /** Target has an active session or cooldown not elapsed. */
  | 'TARGET_RATE_LIMITED'
  /** Target was previously banned (opt-out or manual). */
  | 'TARGET_BANNED'
  /** Probe script malformed or missing required fields. */
  | 'SCRIPT_INVALID'
  /** Inbound response did not arrive within the turn's deadline. */
  | 'RESPONSE_TIMEOUT'
  /** Opt-out keyword detected in inbound; session aborted, target banned. */
  | 'OPT_OUT_DETECTED'
  /** Compliance check rejected the operation (forbidden vertical, etc.). */
  | 'COMPLIANCE_BLOCKED'
  /** Analyzer LLM response could not be parsed even after one retry. */
  | 'ANALYSIS_PARSE_FAILED'
  /** CostGuard rejected the LLM call (monthly cap reached). */
  | 'ANALYSIS_BUDGET_EXCEEDED'
  /** Caller is not a super_admin — research routes require this role. */
  | 'NOT_SUPER_ADMIN'
  /** RESEARCH_MODULE_ENABLED is false. */
  | 'MODULE_DISABLED';

const STATUS_CODE_FOR: Record<ResearchErrorCode, number> = {
  WAHA_UNREACHABLE: 502,
  WAHA_SESSION_NOT_WORKING: 503,
  PHONE_RATE_LIMITED: 429,
  TARGET_RATE_LIMITED: 429,
  TARGET_BANNED: 409,
  SCRIPT_INVALID: 400,
  RESPONSE_TIMEOUT: 504,
  OPT_OUT_DETECTED: 200, // expected outcome of a probe; not an HTTP error
  COMPLIANCE_BLOCKED: 403,
  ANALYSIS_PARSE_FAILED: 502,
  ANALYSIS_BUDGET_EXCEEDED: 429,
  NOT_SUPER_ADMIN: 403,
  MODULE_DISABLED: 404,
};

/**
 * Errors raised by code under `src/research/`. Always carries a
 * `ResearchErrorCode` so callers can branch on the specific failure
 * without parsing strings.
 */
export class ResearchError extends NexusError {
  public readonly researchCode: ResearchErrorCode;

  constructor(params: {
    message: string;
    code: ResearchErrorCode;
    cause?: Error;
    context?: Record<string, unknown>;
  }) {
    super({
      message: params.message,
      code: params.code,
      statusCode: STATUS_CODE_FOR[params.code],
      cause: params.cause,
      context: params.context,
    });
    this.name = 'ResearchError';
    this.researchCode = params.code;
  }
}
