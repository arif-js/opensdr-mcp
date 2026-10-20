import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createConfirmationEngine,
  ExpiringMap,
} from '../../src/engine/confirmation.js';

describe('confirmation engine', () => {
  it('accepts a matching token once', () => {
    const engine = createConfirmationEngine({ secret: 's', now: () => 1000 });
    const { token } = engine.preview('tool', { a: 1 });
    expect(() => engine.verify('tool', { a: 1 }, token)).not.toThrow();
  });

  it('rejects a missing token', () => {
    const engine = createConfirmationEngine({ secret: 's' });
    engine.preview('tool', { a: 1 });
    expect(() => engine.verify('tool', { a: 1 }, undefined)).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
    );
  });

  it('rejects a token for the wrong tool', () => {
    const engine = createConfirmationEngine({ secret: 's' });
    const { token } = engine.preview('tool-a', { a: 1 });
    expect(() => engine.verify('tool-b', { a: 1 }, token)).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
    );
  });

  it('rejects changed input', () => {
    const engine = createConfirmationEngine({ secret: 's' });
    const { token } = engine.preview('tool', { a: 1 });
    expect(() => engine.verify('tool', { a: 2 }, token)).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
    );
  });

  it('rejects an expired token', () => {
    let now = 1000;
    const engine = createConfirmationEngine({ secret: 's', ttlMs: 100, now: () => now });
    const { token } = engine.preview('tool', { a: 1 });
    now = 2000;
    expect(() => engine.verify('tool', { a: 1 }, token)).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
    );
  });

  it('rejects a reused token', () => {
    const engine = createConfirmationEngine({ secret: 's' });
    const { token } = engine.preview('tool', { a: 1 });
    engine.verify('tool', { a: 1 }, token);
    expect(() => engine.verify('tool', { a: 1 }, token)).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
    );
  });

  it('canonicalises: strips confirm/token and sorts keys', () => {
    expect(canonicalJson({ b: 1, a: 2, confirm: true, confirmation_token: 'x' })).toBe(
      '{"a":2,"b":1}',
    );
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it('keeps array order', () => {
    expect(canonicalJson({ ids: ['a', 'b'] })).not.toBe(canonicalJson({ ids: ['b', 'a'] }));
  });
});

describe('ExpiringMap', () => {
  it('stores and takes values', () => {
    const map = new ExpiringMap<string, string>();
    map.set('k1', 'v1', Date.now() + 10000);
    expect(map.size).toBe(1);
    expect(map.get('k1')).toBe('v1');
    expect(map.take('k1')).toBe('v1');
    expect(map.get('k1')).toBeUndefined();
    expect(map.size).toBe(0);
  });

  it('prunes expired entries on read and write', () => {
    let now = 1000;
    const map = new ExpiringMap<string, string>(() => now);
    map.set('k1', 'v1', 1500);
    map.set('k2', 'v2', 2500);
    expect(map.size).toBe(2);

    // Advance time past k1 expiry
    now = 1600;
    expect(map.get('k1')).toBeUndefined();
    expect(map.size).toBe(1); // pruned on get

    // Advance time and add k3, which prunes k2
    now = 2600;
    map.set('k3', 'v3', 3500);
    expect(map.size).toBe(1);
    expect(map.get('k2')).toBeUndefined();
    expect(map.get('k3')).toBe('v3');
  });
});
