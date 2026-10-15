import { readFileSync } from 'node:fs';

// Injected at build time by tsup (`define`), so bundles don't need package.json at runtime.
declare const __OPENSDR_VERSION__: string | undefined;

function resolveVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION =
  typeof __OPENSDR_VERSION__ === 'string' ? __OPENSDR_VERSION__ : resolveVersion();
