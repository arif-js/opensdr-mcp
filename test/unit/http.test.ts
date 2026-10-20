import { afterEach, describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from '../../src/http/client.js';
import { registerSecrets } from '../../src/logger.js';

afterEach(() => registerSecrets([]));

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(calls: Call[], response: () => Response): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return response();
  };
}

describe('http client', () => {
  it('returns parsed JSON and forwards headers, query and body', async () => {
    const calls: Call[] = [];
    const client = createHttpClient({
      fetchImpl: recordingFetch(calls, () => jsonResponse({ ok: 1 })),
      sleep: async () => undefined,
      userAgent: 'opensdr-mcp/test',
    });

    const data = await client.request<{ ok: number }>({
      provider: 'apollo',
      method: 'POST',
      url: 'https://api.example.test/v1/people',
      query: { page: 2, q: 'vp eng' },
      body: { limit: 5 },
    });

    expect(data).toEqual({ ok: 1 });
    expect(calls[0].url).toContain('page=2');
    expect(calls[0].url).toContain('q=vp+eng');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['user-agent']).toBe('opensdr-mcp/test');
    expect(headers['content-type']).toBe('application/json');
    expect(calls[0].init.body).toBe('{"limit":5}');
  });

  it('retries 429 and honours Retry-After', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const client = createHttpClient({
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse(
            { error: 'slow down' },
            { status: 429, headers: { 'retry-after': '2' } },
          );
        }
        return jsonResponse({ ok: true });
      },
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
    });

    const data = await client.request({ provider: 'apollo', url: 'https://api.example.test/a' });
    expect(data).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it('does not retry a non-idempotent POST', async () => {
    let attempts = 0;
    const client = createHttpClient({
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({ error: 'unavailable' }, { status: 503 });
      },
      sleep: async () => undefined,
      random: () => 0,
    });

    await expect(
      client.request({
        provider: 'instantly',
        method: 'POST',
        url: 'https://api.example.test/campaigns',
        body: {},
        idempotent: false,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(attempts).toBe(1);
  });

  it('maps status codes to error codes', async () => {
    const cases: [number, string][] = [
      [401, 'AUTH_FAILED'],
      [403, 'PERMISSION_DENIED'],
      [404, 'NOT_FOUND'],
      [402, 'QUOTA_EXCEEDED'],
      [429, 'RATE_LIMITED'],
      [500, 'PROVIDER_ERROR'],
    ];
    for (const [status, code] of cases) {
      const client = createHttpClient({
        fetchImpl: async () => jsonResponse({}, { status }),
        sleep: async () => undefined,
        maxRetries: 0,
      });
      await expect(
        client.request({ provider: 'apollo', url: 'https://api.example.test/a' }),
      ).rejects.toMatchObject({ code });
    }
  });

  it('classifies a quota body on a 403 as QUOTA_EXCEEDED', async () => {
    const client = createHttpClient({
      fetchImpl: async () => jsonResponse({ error: 'quota exceeded' }, { status: 403 }),
      sleep: async () => undefined,
      maxRetries: 0,
    });
    await expect(
      client.request({ provider: 'apollo', url: 'https://api.example.test/a' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('times out', async () => {
    const client = createHttpClient({
      fetchImpl: async () => {
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        throw error;
      },
      sleep: async () => undefined,
      maxRetries: 0,
    });
    await expect(
      client.request({ provider: 'exa', url: 'https://api.example.test/a' }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('retries network errors then succeeds', async () => {
    let attempts = 0;
    const client = createHttpClient({
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('fetch failed');
        return jsonResponse({ ok: true });
      },
      sleep: async () => undefined,
      random: () => 0,
    });
    const data = await client.request({ provider: 'apollo', url: 'https://api.example.test/a' });
    expect(data).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it('redacts secrets from error messages', async () => {
    registerSecrets(['supersecretvalue123']);
    const client = createHttpClient({
      fetchImpl: async () => jsonResponse({ error: 'supersecretvalue123' }, { status: 500 }),
      sleep: async () => undefined,
      maxRetries: 0,
    });
    try {
      await client.request({ provider: 'apollo', url: 'https://api.example.test/a' });
      throw new Error('expected request to reject');
    } catch (error) {
      expect((error as Error).message).not.toContain('supersecretvalue123');
      expect((error as Error).message).toContain('***');
    }
  });

  it('caps the response body size', async () => {
    let attempts = 0;
    const client = createHttpClient({
      fetchImpl: async () => {
        attempts += 1;
        return new Response('x'.repeat(100));
      },
      sleep: async () => undefined,
      maxResponseBytes: 10,
    });
    await expect(
      client.request({ provider: 'apollo', url: 'https://api.example.test/a' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(attempts).toBe(1);
  });

  it('rejects early based on content-length header', async () => {
    const client = createHttpClient({
      fetchImpl: async () =>
        new Response('ok', {
          headers: { 'content-length': '999999' },
        }),
      sleep: async () => undefined,
      maxResponseBytes: 100,
    });
    await expect(
      client.request({ provider: 'apollo', url: 'https://api.example.test/a' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: expect.stringContaining('exceeded the 100 byte cap'),
    });
  });

  it('rejects invalid JSON', async () => {
    const client = createHttpClient({
      fetchImpl: async () => new Response('not-json'),
      sleep: async () => undefined,
      maxRetries: 0,
    });
    await expect(
      client.request({ provider: 'apollo', url: 'https://api.example.test/a' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});
