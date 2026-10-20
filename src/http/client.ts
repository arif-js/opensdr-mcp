import { type ErrorCode, OpenSdrError } from '../errors.js';
import { redact } from '../logger.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 60000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export interface HttpClientOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  userAgent?: string;
  maxRetries?: number;
  maxResponseBytes?: number;
  random?: () => number;
}

export interface RequestOptions {
  provider: string;
  method?: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  idempotent?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpClient {
  request<T>(options: RequestOptions): Promise<T>;
}

function buildUrl(url: string, query: RequestOptions['query']): string {
  if (!query) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    target.searchParams.set(key, String(value));
  }
  return target.toString();
}

function mapStatus(status: number, bodyText: string): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return /quota|limit exceeded/i.test(bodyText) ? 'QUOTA_EXCEEDED' : 'BAD_INPUT';
    case 401:
      return 'AUTH_FAILED';
    case 402:
      return 'QUOTA_EXCEEDED';
    case 403:
      return /quota|limit exceeded/i.test(bodyText) ? 'QUOTA_EXCEEDED' : 'PERMISSION_DENIED';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    case 451:
      return 'SUPPRESSED';
    default:
      return 'PROVIDER_ERROR';
  }
}

function hintFor(code: ErrorCode): string | undefined {
  switch (code) {
    case 'AUTH_FAILED':
      return 'Check that the API key for this provider is correct and active.';
    case 'PERMISSION_DENIED':
      return 'The provider rejected this key or scope. Some Apollo endpoints require a master API key.';
    case 'QUOTA_EXCEEDED':
      return 'The provider account is out of credits or over its plan limit.';
    case 'RATE_LIMITED':
      return 'Reduce the request rate or retry after the indicated delay.';
    case 'NOT_FOUND':
      return 'The requested resource does not exist at this provider.';
    default:
      return undefined;
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function errorMessage(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const userAgent = options.userAgent ?? 'opensdr-mcp';
  const random = options.random ?? Math.random;

  const backoffMs = (attempt: number): number =>
    Math.min(30000, 500 * 2 ** attempt) + Math.floor(random() * 250);

  const readBody = async (response: Response, provider: string): Promise<string> => {
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const parsedLength = Number(contentLength);
      if (Number.isFinite(parsedLength) && parsedLength > maxResponseBytes) {
        throw new OpenSdrError({
          code: 'PROVIDER_ERROR',
          message: `${provider} response exceeded the ${maxResponseBytes} byte cap.`,
          provider,
          retryable: false,
        });
      }
    }

    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > maxResponseBytes) {
              await reader.cancel().catch(() => undefined);
              throw new OpenSdrError({
                code: 'PROVIDER_ERROR',
                message: `${provider} response exceeded the ${maxResponseBytes} byte cap.`,
                provider,
                retryable: false,
              });
            }
            chunks.push(value);
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // best effort
        }
      }
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(combined);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxResponseBytes) {
      throw new OpenSdrError({
        code: 'PROVIDER_ERROR',
        message: `${provider} response exceeded the ${maxResponseBytes} byte cap.`,
        provider,
        retryable: false,
      });
    }
    return new TextDecoder().decode(buffer);
  };

  const parseJson = <T>(text: string, provider: string): T => {
    if (text.trim() === '') return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new OpenSdrError({
        code: 'PROVIDER_ERROR',
        message: `${provider} returned a response that was not valid JSON.`,
        provider,
        retryable: false,
      });
    }
  };

  const request = async <T>(requestOptions: RequestOptions): Promise<T> => {
    const provider = requestOptions.provider;
    const method = (requestOptions.method ?? 'GET').toUpperCase();
    const idempotent = requestOptions.idempotent ?? (method === 'GET' || method === 'HEAD');
    const url = buildUrl(requestOptions.url, requestOptions.query);
    const timeoutMs = requestOptions.timeoutMs ?? defaultTimeout;

    const headers: Record<string, string> = {
      'user-agent': userAgent,
      accept: 'application/json',
      ...requestOptions.headers,
    };
    let body: string | undefined;
    if (requestOptions.body !== undefined) {
      body = JSON.stringify(requestOptions.body);
      const hasContentType = Object.keys(headers).some(
        (key) => key.toLowerCase() === 'content-type',
      );
      if (!hasContentType) headers['content-type'] = 'application/json';
    }

    let lastError: OpenSdrError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const timeouts = [AbortSignal.timeout(timeoutMs)];
      if (requestOptions.signal) timeouts.push(requestOptions.signal);
      const signal =
        timeouts.length > 1 && typeof AbortSignal.any === 'function'
          ? AbortSignal.any(timeouts)
          : timeouts[0];

      let retryAfter: number | null = null;

      try {
        const response = await fetchImpl(url, { method, headers, body, signal });
        const text = await readBody(response, provider);

        if (!response.ok) {
          const code = mapStatus(response.status, text);
          const retryable = RETRY_STATUSES.has(response.status);
          retryAfter = parseRetryAfter(response.headers.get('retry-after'));
          throw new OpenSdrError({
            code,
            message: redact(
              `${provider} responded with HTTP ${response.status}: ${text.slice(0, 300)}`,
            ),
            provider,
            retryable,
            hint: hintFor(code),
          });
        }

        return parseJson<T>(text, provider);
      } catch (error) {
        const normalized =
          error instanceof OpenSdrError
            ? error
            : new OpenSdrError({
                code: isAbort(error) ? 'TIMEOUT' : 'PROVIDER_ERROR',
                message: isAbort(error)
                  ? `${provider} request timed out after ${timeoutMs}ms.`
                  : `${provider} request failed: ${errorMessage(error)}`,
                provider,
                retryable: true,
                hint: isAbort(error)
                  ? 'Increase OPENSDR_HTTP_TIMEOUT_MS or retry later.'
                  : undefined,
                cause: error,
              });

        lastError = normalized;
        if (!normalized.retryable || !idempotent || attempt >= maxRetries) throw normalized;
        await sleep(retryAfter ?? backoffMs(attempt));
      }
    }

    throw (
      lastError ??
      new OpenSdrError({
        code: 'PROVIDER_ERROR',
        message: `${provider} request failed after ${maxRetries} retries.`,
        provider,
        retryable: true,
      })
    );
  };

  return { request };
}
