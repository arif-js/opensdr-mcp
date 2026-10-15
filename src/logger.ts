export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

let registeredSecrets: string[] = [];

export function registerSecrets(values: Iterable<string | undefined | null>): void {
  const next = new Set<string>();
  for (const value of values) {
    if (typeof value === 'string' && value.length >= 8) next.add(value);
  }
  registeredSecrets = [...next];
}

export function redact(text: string): string {
  let output = text;
  for (const secret of registeredSecrets) {
    if (secret.length === 0) continue;
    output = output.split(secret).join('***');
  }
  return output;
}

export interface Logger {
  readonly level: LogLevel;
  error(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  write?: (line: string) => void;
}

function formatMeta(meta: unknown): string {
  if (meta === undefined) return '';
  if (meta instanceof Error) return ` ${redact(meta.message)}`;
  try {
    return ` ${redact(JSON.stringify(meta))}`;
  } catch {
    return ` ${redact(String(meta))}`;
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const write = options.write ?? ((line: string) => void process.stderr.write(line));

  const emit = (logLevel: LogLevel, message: string, meta?: unknown): void => {
    if (LEVEL_ORDER[logLevel] > LEVEL_ORDER[level]) return;
    write(`[opensdr] ${logLevel}: ${redact(message)}${formatMeta(meta)}\n`);
  };

  return {
    level,
    error: (message, meta) => emit('error', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    info: (message, meta) => emit('info', message, meta),
    debug: (message, meta) => emit('debug', message, meta),
  };
}
