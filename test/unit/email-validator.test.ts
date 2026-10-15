import { describe, expect, it } from 'vitest';
import { type DnsResolver, validateEmail } from '../../src/engine/email-validator.js';

function rejection(code: string): () => Promise<never> {
  return () => Promise.reject(Object.assign(new Error(code), { code }));
}

function resolver(overrides: Partial<DnsResolver> = {}): DnsResolver {
  return {
    resolveMx: async () => [{ exchange: 'mx.example.test', priority: 1 }],
    resolve4: async () => [],
    resolve6: async () => [],
    ...overrides,
  };
}

describe('validateEmail', () => {
  it('accepts a syntactically valid address with MX', async () => {
    const result = await validateEmail('jane.doe@northwind.example', { dns: resolver() });
    expect(result).toMatchObject({ syntax: true, mx: 'ok', disposable: false, role_based: false });
    expect(result.status_cap).toBeUndefined();
  });

  it('flags a missing @ as a syntax failure', async () => {
    const result = await validateEmail('not-an-email', { dns: resolver() });
    expect(result.syntax).toBe(false);
    expect(result.status_cap).toBe('invalid');
  });

  it('returns mx "none" when there is no MX and no A/AAAA record', async () => {
    const result = await validateEmail('jane@nxdomain.example', {
      dns: resolver({
        resolveMx: rejection('ENOTFOUND'),
        resolve4: rejection('ENOTFOUND'),
        resolve6: rejection('ENOTFOUND'),
      }),
    });
    expect(result.mx).toBe('none');
    expect(result.status_cap).toBe('invalid');
  });

  it('falls back to an A record as an implicit MX', async () => {
    const result = await validateEmail('jane@implicit.example', {
      dns: resolver({ resolveMx: async () => [], resolve4: async () => ['192.0.2.1'] }),
    });
    expect(result.mx).toBe('ok');
  });

  it('returns mx "unknown" on a DNS timeout', async () => {
    const result = await validateEmail('jane@slow.example', {
      dns: resolver({ resolveMx: rejection('ETIMEDOUT') }),
    });
    expect(result.mx).toBe('unknown');
    expect(result.status_cap).toBeUndefined();
  });

  it('flags a disposable domain', async () => {
    const result = await validateEmail('jane@mailinator.com', { dns: resolver() });
    expect(result.disposable).toBe(true);
    expect(result.status_cap).toBe('invalid');
  });

  it('flags a role address and caps the status at likely', async () => {
    const result = await validateEmail('sales@northwind.example', { dns: resolver() });
    expect(result.role_based).toBe(true);
    expect(result.status_cap).toBe('likely');
  });

  it('treats role+digits as role-based', async () => {
    const result = await validateEmail('support2@northwind.example', { dns: resolver() });
    expect(result.role_based).toBe(true);
  });
});
