import { afterEach, describe, expect, it } from 'vitest';
import { OpenSdrError, toErrorEnvelope } from '../../src/errors.js';
import { registerSecrets } from '../../src/logger.js';

afterEach(() => registerSecrets([]));

describe('toErrorEnvelope', () => {
  it('maps an OpenSdrError with code, provider, retryable and hint', () => {
    const envelope = toErrorEnvelope(
      new OpenSdrError({
        code: 'RATE_LIMITED',
        message: 'Apollo rate limit hit.',
        provider: 'apollo',
        retryable: true,
        hint: 'Slow down.',
      }),
    );
    expect(envelope).toEqual({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Apollo rate limit hit.',
        provider: 'apollo',
        retryable: true,
        hint: 'Slow down.',
      },
    });
  });

  it('turns an unknown Error into INTERNAL without a stack', () => {
    const envelope = toErrorEnvelope(new Error('kaboom'));
    expect(envelope.error.code).toBe('INTERNAL');
    expect(envelope.error.retryable).toBe(false);
    expect(JSON.stringify(envelope)).not.toContain('at ');
  });

  it('stringifies non-Error throws', () => {
    expect(toErrorEnvelope('plain string').error.message).toBe('plain string');
  });

  it('redacts secrets in messages and hints', () => {
    registerSecrets(['hunter-key-1234567890']);
    const envelope = toErrorEnvelope(
      new OpenSdrError({
        code: 'AUTH_FAILED',
        message: 'key hunter-key-1234567890 rejected',
        hint: 'check hunter-key-1234567890',
      }),
    );
    expect(envelope.error.message).not.toContain('hunter-key-1234567890');
    expect(envelope.error.message).toContain('***');
    expect(envelope.error.hint).toContain('***');
  });

  it('preserves the default retryable=false', () => {
    const envelope = toErrorEnvelope(new OpenSdrError({ code: 'BAD_INPUT', message: 'x' }));
    expect(envelope.error.retryable).toBe(false);
  });
});
