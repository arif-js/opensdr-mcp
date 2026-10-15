import { createHash } from 'node:crypto';
import { OpenSdrError } from '../errors.js';

export interface CursorData {
  page: number;
  per_page: number;
  hash: string;
}

export function hashQuery(input: unknown): string {
  return createHash('sha1')
    .update(JSON.stringify(input ?? {}))
    .digest('hex')
    .slice(0, 16);
}

export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorData {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as Partial<CursorData>;
    if (
      typeof parsed.page !== 'number' ||
      !Number.isInteger(parsed.page) ||
      parsed.page < 1 ||
      typeof parsed.per_page !== 'number' ||
      typeof parsed.hash !== 'string'
    ) {
      throw new Error('malformed cursor');
    }
    return { page: parsed.page, per_page: parsed.per_page, hash: parsed.hash };
  } catch {
    throw new OpenSdrError({
      code: 'BAD_INPUT',
      message: 'Invalid cursor.',
      hint: 'Omit `cursor` to start from the first page.',
    });
  }
}

export function assertCursorMatches(cursor: CursorData, expectedHash: string): void {
  if (cursor.hash !== expectedHash) {
    throw new OpenSdrError({
      code: 'BAD_INPUT',
      message: 'The cursor does not match the current search filters.',
      hint: 'Re-run the search without `cursor` to start over.',
    });
  }
}
