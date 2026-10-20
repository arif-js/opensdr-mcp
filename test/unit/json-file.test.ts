import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFile, type JsonFileOptions } from '../../src/store/json-file.js';

interface Counter {
  schema_version: number;
  count: number;
}

let dir: string;
let dataDir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opensdr-store-'));
  dataDir = path.join(dir, 'data');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function counterFile(
  name = 'counter.json',
  overrides: Partial<JsonFileOptions<Counter>> = {},
): JsonFile<Counter> {
  return new JsonFile<Counter>({
    path: path.join(dataDir, name),
    schemaVersion: 1,
    defaultValue: () => ({ schema_version: 1, count: 0 }),
    ...overrides,
  });
}

describe('JsonFile', () => {
  it('returns the default and does not create the dir on read', async () => {
    const file = counterFile();
    expect(await file.read()).toEqual({ schema_version: 1, count: 0 });
    await expect(fs.stat(dataDir)).rejects.toBeTruthy();
  });

  it('creates the data dir lazily on first write', async () => {
    const file = counterFile();
    await file.update((current) => ({ ...current, count: current.count + 1 }));
    expect((await file.read()).count).toBe(1);
    await expect(fs.stat(dataDir)).resolves.toBeTruthy();
  });

  it('writes files with 0600 permissions and dirs with 0700 on POSIX', async () => {
    if (process.platform === 'win32') return;
    const file = counterFile();
    await file.update((current) => current);
    expect((await fs.stat(file.filePath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(dataDir)).mode & 0o777).toBe(0o700);
  });

  it('does not lose writes from two concurrent instances', async () => {
    const a = counterFile();
    const b = counterFile();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? a : b).update((current) => ({
          ...current,
          count: current.count + 1,
        })),
      ),
    );
    expect((await a.read()).count).toBe(20);
  });

  it('quarantines corrupt JSON and starts empty', async () => {
    const warnings: string[] = [];
    const file = counterFile('corrupt.json', { warn: (message) => warnings.push(message) });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(file.filePath, '{ not json');
    expect(await file.read()).toEqual({ schema_version: 1, count: 0 });
    expect(warnings).toHaveLength(1);
    const entries = await fs.readdir(dataDir);
    expect(entries.some((entry) => entry.startsWith('corrupt.json.corrupt-'))).toBe(true);
  });

  it('quarantines a non-object payload', async () => {
    const file = counterFile('array.json');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(file.filePath, '[1,2,3]');
    expect(await file.read()).toEqual({ schema_version: 1, count: 0 });
  });

  it('runs migrations when the schema version changes', async () => {
    const file = new JsonFile<{ schema_version: number; value: number }>({
      path: path.join(dataDir, 'migrate.json'),
      schemaVersion: 2,
      defaultValue: () => ({ schema_version: 2, value: 0 }),
      migrate: (raw) => ({ schema_version: 2, value: (raw as { value: number }).value + 1 }),
    });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(file.filePath, JSON.stringify({ schema_version: 1, value: 41 }));
    expect(await file.read()).toEqual({ schema_version: 2, value: 42 });
  });

  it('clears a stale lock', async () => {
    const file = counterFile('stale.json', { lockStaleMs: 20 });
    await fs.mkdir(dataDir, { recursive: true });
    const lockDir = `${file.filePath}.lock`;
    await fs.mkdir(lockDir);
    const past = Date.now() / 1000 - 60;
    await fs.utimes(lockDir, past, past);
    await file.update((current) => ({ ...current, count: 7 }));
    expect((await file.read()).count).toBe(7);
  });

  it('times out when the lock is held', async () => {
    const file = counterFile('locked.json', { lockTimeoutMs: 30, lockStaleMs: 60000 });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(`${file.filePath}.lock`);
    await expect(file.update((current) => current)).rejects.toMatchObject({ code: 'STORE_ERROR' });
  });

  it('cleans up tmp files if writeAtomic fails', async () => {
    const file = counterFile('fail.json');
    // Force write failure by making dataDir a read-only file or invalid
    await fs.mkdir(dataDir, { recursive: true });
    // Write once successfully
    await file.update((current) => ({ ...current, count: 1 }));
    // Attempt to write an un-stringifiable value (e.g. BigInt)
    await expect(
      file.update((current) => ({
        ...current,
        // @ts-expect-error intentionally invalid JSON
        count: 10n,
      })),
    ).rejects.toThrow();
    const files = await fs.readdir(dataDir);
    expect(files.filter((f) => f.includes('.tmp-'))).toHaveLength(0);
  });

  it('uses mtime cache on repeated reads', async () => {
    const file = counterFile('cached.json');
    await file.update((current) => ({ ...current, count: 5 }));
    const first = await file.read();
    const second = await file.read();
    expect(first).toBe(second); // same object reference from cache
  });
});
