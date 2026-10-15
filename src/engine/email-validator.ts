import { promises as dns } from 'node:dns';
import type { EmailStatus } from '../types.js';
import { DISPOSABLE_DOMAIN_SET, ROLE_PREFIXES } from './data/disposable-domains.js';

export interface DnsResolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

export type MxStatus = 'ok' | 'none' | 'unknown';

export interface EmailValidation {
  syntax: boolean;
  mx: MxStatus;
  disposable: boolean;
  role_based: boolean;
  status_cap?: EmailStatus;
}

export interface ValidateOptions {
  dns: DnsResolver;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const defaultDnsResolver: DnsResolver = {
  resolveMx: (domain) => dns.resolveMx(domain),
  resolve4: (domain) => dns.resolve4(domain),
  resolve6: (domain) => dns.resolve6(domain),
};

export function isValidSyntax(email: string): boolean {
  const value = email.trim();
  if (!EMAIL_PATTERN.test(value)) return false;
  const [local, domain] = value.split('@');
  if (!local || !domain) return false;
  if (local.length > 64 || value.length > 254) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.startsWith('-') || domain.endsWith('-') || domain.includes('..')) return false;
  return true;
}

export function isDisposable(domain: string): boolean {
  return DISPOSABLE_DOMAIN_SET.has(domain.toLowerCase());
}

export function isRoleBased(localPart: string): boolean {
  const local = localPart.toLowerCase().split('+')[0];
  if (ROLE_PREFIXES.has(local)) return true;
  const withoutDigits = local.replace(/\d+$/, '');
  return withoutDigits !== local && ROLE_PREFIXES.has(withoutDigits);
}

function isNoData(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOTFOUND' || code === 'ENODATA';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('DNS lookup timed out');
      (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function checkMx(
  domain: string,
  dnsResolver: DnsResolver,
  timeoutMs: number,
): Promise<MxStatus> {
  try {
    const records = await withTimeout(dnsResolver.resolveMx(domain), timeoutMs);
    if (records.length > 0) return 'ok';
  } catch (error) {
    if (!isNoData(error)) return 'unknown';
  }
  try {
    const a = await withTimeout(dnsResolver.resolve4(domain), timeoutMs);
    if (a.length > 0) return 'ok';
  } catch {
    // fall through to AAAA
  }
  try {
    const aaaa = await withTimeout(dnsResolver.resolve6(domain), timeoutMs);
    if (aaaa.length > 0) return 'ok';
  } catch {
    // no implicit MX either
  }
  return 'none';
}

export async function validateEmail(
  email: string,
  options: ValidateOptions,
): Promise<EmailValidation> {
  const value = email.trim().toLowerCase();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const syntax = isValidSyntax(value);

  if (!syntax) {
    return {
      syntax: false,
      mx: 'unknown',
      disposable: false,
      role_based: false,
      status_cap: 'invalid',
    };
  }

  const [localPart, domain] = value.split('@');
  const disposable = isDisposable(domain);
  const roleBased = isRoleBased(localPart);
  const mx = await checkMx(domain, options.dns, timeoutMs);

  let statusCap: EmailStatus | undefined;
  if (mx === 'none' || disposable) statusCap = 'invalid';
  else if (roleBased) statusCap = 'likely';

  return { syntax, mx, disposable, role_based: roleBased, status_cap: statusCap };
}
