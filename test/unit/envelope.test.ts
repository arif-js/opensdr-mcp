import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenSdrError } from '../../src/errors.js';
import {
  badInput,
  capEnvelope,
  fail,
  MAX_RESPONSE_BYTES,
  ok,
  okComplete,
} from '../../src/tools/envelope.js';

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe('ok', () => {
  it('builds a success envelope with default meta', () => {
    const result = ok({ hello: 'world' });
    const envelope = JSON.parse(textOf(result));
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ hello: 'world' });
    expect(envelope.meta).toEqual({
      demo: false,
      sources: [],
      credits_used_estimate: 0,
      cached: false,
      truncated: false,
      next_cursor: null,
    });
    expect(envelope.warnings).toEqual([]);
    expect(result.isError).toBeUndefined();
  });

  it('merges meta overrides and keeps warnings', () => {
    const result = ok({ a: 1 }, { demo: true, sources: ['apollo'] }, ['note']);
    const envelope = JSON.parse(textOf(result));
    expect(envelope.meta.demo).toBe(true);
    expect(envelope.meta.sources).toEqual(['apollo']);
    expect(envelope.warnings).toEqual(['note']);
  });
});

describe('fail', () => {
  it('wraps an OpenSdrError with isError', () => {
    const result = fail(
      new OpenSdrError({ code: 'NOT_CONFIGURED', message: 'missing', hint: 'set it' }),
    );
    const envelope = JSON.parse(textOf(result));
    expect(result.isError).toBe(true);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('NOT_CONFIGURED');
    expect(envelope.error.hint).toBe('set it');
  });

  it('turns a raw Error into INTERNAL', () => {
    const result = fail(new Error('boom'));
    const envelope = JSON.parse(textOf(result));
    expect(result.isError).toBe(true);
    expect(envelope.error.code).toBe('INTERNAL');
  });

  it('passes an existing error envelope through', () => {
    const envelope = { ok: false, error: { code: 'SUPPRESSED', message: 'x', retryable: false } };
    expect(JSON.parse(textOf(fail(envelope)))).toEqual(envelope);
  });
});

describe('capEnvelope', () => {
  it('flags and truncates oversize arrays', () => {
    const items = Array.from({ length: 3000 }, (_, i) => ({ i, text: 'x'.repeat(50) }));
    const capped = capEnvelope({
      ok: true,
      data: { items },
      meta: {
        demo: false,
        sources: [],
        credits_used_estimate: 0,
        cached: false,
        truncated: false,
        next_cursor: null,
      },
      warnings: [],
    });
    expect(capped.meta.truncated).toBe(true);
    expect(capped.warnings).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(capped), 'utf8')).toBeLessThanOrEqual(
      MAX_RESPONSE_BYTES,
    );
    expect((capped.data as { items: unknown[] }).items.length).toBeLessThan(items.length);
  });

  it('leaves a small envelope untouched', () => {
    const envelope = ok({ a: 1 });
    expect(JSON.parse(textOf(envelope)).meta.truncated).toBe(false);
  });
});

describe('badInput', () => {
  it('formats zod issues into a BAD_INPUT error', () => {
    const parsed = z.object({ name: z.string() }).safeParse({ name: 5 });
    if (parsed.success) throw new Error('expected failure');
    const error = badInput(parsed.error);
    expect(error.code).toBe('BAD_INPUT');
    expect(error.message).toContain('name');
  });
});

describe('okComplete', () => {
  it('refuses to truncate an oversize preview', () => {
    const big = {
      eligible: Array.from({ length: 2000 }, (_, i) => ({ id: i, pad: 'x'.repeat(50) })),
    };
    expect(() => okComplete(big)).toThrow(OpenSdrError);
    try {
      okComplete(big);
    } catch (error) {
      expect((error as OpenSdrError).code).toBe('BAD_INPUT');
    }
  });

  it('returns a normal envelope when it fits', () => {
    const result = okComplete({ eligible: [1, 2, 3] });
    expect(JSON.parse(textOf(result)).data.eligible).toEqual([1, 2, 3]);
  });
});
