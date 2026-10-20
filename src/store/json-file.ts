import { promises as fs } from 'node:fs';
import path from 'node:path';
import { OpenSdrError } from '../errors.js';

export interface Versioned {
  schema_version: number;
}

export interface JsonFileOptions<T extends Versioned> {
  path: string;
  schemaVersion: number;
  defaultValue: () => T;
  migrate?: (raw: unknown, fromVersion: number) => T;
  warn?: (message: string, meta?: unknown) => void;
  fileMode?: number;
  dirMode?: number;
  lockStaleMs?: number;
  lockTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

let tmpCounter = 0;

export class JsonFile<T extends Versioned> {
  private readonly options: JsonFileOptions<T>;
  private readonly fileMode: number;
  private readonly dirMode: number;
  private readonly lockStaleMs: number;
  private readonly lockTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private cachedValue: T | null = null;
  private cachedMtimeMs = -1;
  private cachedSize = -1;

  constructor(options: JsonFileOptions<T>) {
    this.options = options;
    this.fileMode = options.fileMode ?? 0o600;
    this.dirMode = options.dirMode ?? 0o700;
    this.lockStaleMs = options.lockStaleMs ?? 10000;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10000;
    this.sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  get filePath(): string {
    return this.options.path;
  }

  private fresh(): T {
    return { ...this.options.defaultValue(), schema_version: this.options.schemaVersion };
  }

  private async quarantine(): Promise<void> {
    this.cachedValue = null;
    this.cachedMtimeMs = -1;
    this.cachedSize = -1;
    const target = `${this.options.path}.corrupt-${Date.now()}`;
    try {
      await fs.rename(this.options.path, target);
    } catch {
      // best effort
    }
    this.options.warn?.(`Quarantined corrupt store file to ${path.basename(target)}`);
  }

  private async parse(text: string): Promise<T> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await this.quarantine();
      return this.fresh();
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      await this.quarantine();
      return this.fresh();
    }
    const version = (raw as { schema_version?: unknown }).schema_version;
    if (typeof version === 'number' && version !== this.options.schemaVersion) {
      if (this.options.migrate) {
        const migrated = this.options.migrate(raw, version);
        return { ...migrated, schema_version: this.options.schemaVersion };
      }
      return { ...(raw as T), schema_version: this.options.schemaVersion };
    }
    return { ...(raw as T), schema_version: this.options.schemaVersion };
  }

  async read(): Promise<T> {
    try {
      const stat = await fs.stat(this.options.path);
      if (
        this.cachedValue !== null &&
        stat.mtimeMs === this.cachedMtimeMs &&
        stat.size === this.cachedSize
      ) {
        return this.cachedValue;
      }
      const text = await fs.readFile(this.options.path, 'utf8');
      const parsed = await this.parse(text);
      this.cachedValue = parsed;
      this.cachedMtimeMs = stat.mtimeMs;
      this.cachedSize = stat.size;
      return parsed;
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        this.cachedValue = null;
        this.cachedMtimeMs = -1;
        this.cachedSize = -1;
        return this.fresh();
      }
      throw new OpenSdrError({
        code: 'STORE_ERROR',
        message: `Failed to read ${this.options.path}: ${(error as Error).message}`,
        retryable: false,
      });
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    const lockDir = `${this.options.path}.lock`;
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        await fs.mkdir(lockDir);
        return async () => {
          await fs.rmdir(lockDir).catch(() => undefined);
        };
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) {
          throw new OpenSdrError({
            code: 'STORE_ERROR',
            message: `Failed to acquire lock ${lockDir}: ${(error as Error).message}`,
            retryable: false,
          });
        }
        try {
          const stat = await fs.stat(lockDir);
          if (Date.now() - stat.mtimeMs > this.lockStaleMs) {
            await fs.rmdir(lockDir).catch(() => undefined);
            continue;
          }
        } catch {
          // lock disappeared; retry
          continue;
        }
        if (Date.now() > deadline) {
          throw new OpenSdrError({
            code: 'STORE_ERROR',
            message: `Timed out acquiring lock for ${this.options.path}`,
            retryable: true,
          });
        }
        await this.sleep(15 + Math.floor(Math.random() * 20));
      }
    }
  }

  private async safeRename(src: string, dest: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rename(src, dest);
        return;
      } catch (error) {
        if (
          process.platform === 'win32' &&
          (isErrno(error, 'EPERM') || isErrno(error, 'EBUSY') || isErrno(error, 'EACCES')) &&
          attempt < 4
        ) {
          await this.sleep(20 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
  }

  private async writeAtomic(value: T): Promise<void> {
    const tmp = `${this.options.path}.tmp-${process.pid}-${tmpCounter++}`;
    try {
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: this.fileMode });
      if (process.platform !== 'win32') await fs.chmod(tmp, this.fileMode);
      await this.safeRename(tmp, this.options.path);
    } catch (error) {
      await fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
  }

  async update(fn: (current: T) => T | Promise<T>): Promise<T> {
    const dir = path.dirname(this.options.path);
    await fs.mkdir(dir, { recursive: true, mode: this.dirMode });
    if (process.platform !== 'win32') await fs.chmod(dir, this.dirMode).catch(() => undefined);

    const release = await this.acquireLock();
    try {
      const current = await this.read();
      const next = await fn(current);
      const payload = { ...next, schema_version: this.options.schemaVersion };
      await this.writeAtomic(payload);
      this.cachedValue = payload;
      const stat = await fs.stat(this.options.path).catch(() => undefined);
      this.cachedMtimeMs = stat ? stat.mtimeMs : -1;
      this.cachedSize = stat ? stat.size : -1;
      return payload;
    } finally {
      await release();
    }
  }
}
