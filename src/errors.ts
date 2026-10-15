import { redact } from './logger.js';

export const ERROR_CODES = [
  'BAD_INPUT',
  'NOT_CONFIGURED',
  'AUTH_FAILED',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'BUDGET_EXCEEDED',
  'NOT_FOUND',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'CONFIRMATION_REQUIRED',
  'READ_ONLY_MODE',
  'SUPPRESSED',
  'STORE_ERROR',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface OpenSdrErrorOptions {
  code: ErrorCode;
  message: string;
  provider?: string;
  retryable?: boolean;
  hint?: string;
  cause?: unknown;
}

export class OpenSdrError extends Error {
  readonly code: ErrorCode;
  readonly provider?: string;
  readonly retryable: boolean;
  readonly hint?: string;

  constructor(options: OpenSdrErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OpenSdrError';
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable ?? false;
    this.hint = options.hint;
  }
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    provider?: string;
    retryable: boolean;
    hint?: string;
  };
}

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof OpenSdrError) {
    const envelope: ErrorEnvelope = {
      ok: false,
      error: {
        code: error.code,
        message: redact(error.message),
        retryable: error.retryable,
      },
    };
    if (error.provider) envelope.error.provider = error.provider;
    if (error.hint) envelope.error.hint = redact(error.hint);
    return envelope;
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: { code: 'INTERNAL', message: redact(message), retryable: false },
  };
}
