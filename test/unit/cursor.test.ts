import { describe, expect, it } from 'vitest';
import {
  assertCursorMatches,
  decodeCursor,
  encodeCursor,
  hashQuery,
} from '../../src/engine/cursor.js';

describe('cursor', () => {
  it('round-trips page data', () => {
    const encoded = encodeCursor({ page: 3, per_page: 10, hash: 'abc123' });
    expect(decodeCursor(encoded)).toEqual({ page: 3, per_page: 10, hash: 'abc123' });
  });

  it('throws BAD_INPUT for a malformed cursor', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrowError(
      expect.objectContaining({ code: 'BAD_INPUT' }),
    );
  });

  it('throws BAD_INPUT for a cursor with a bad shape', () => {
    const bad = Buffer.from(JSON.stringify({ page: 0 }), 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrowError(expect.objectContaining({ code: 'BAD_INPUT' }));
  });

  it('rejects a mismatched query hash', () => {
    expect(() => assertCursorMatches({ page: 2, per_page: 5, hash: 'a' }, 'b')).toThrowError(
      expect.objectContaining({ code: 'BAD_INPUT' }),
    );
  });

  it('accepts a matching query hash', () => {
    expect(() => assertCursorMatches({ page: 2, per_page: 5, hash: 'same' }, 'same')).not.toThrow();
  });

  it('hashes deterministically and differs for different input', () => {
    expect(hashQuery({ a: 1 })).toBe(hashQuery({ a: 1 }));
    expect(hashQuery({ a: 1 })).not.toBe(hashQuery({ a: 2 }));
  });
});
