import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, redact, registerSecrets } from '../../src/logger.js';

afterEach(() => {
  registerSecrets([]);
  vi.restoreAllMocks();
});

describe('logger', () => {
  it('never writes to stdout', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });

    logger.error('boom');
    logger.warn('careful');
    logger.info('hello');
    logger.debug('detail');

    expect(stdout).not.toHaveBeenCalled();
    expect(lines).toHaveLength(4);
  });

  it('writes to stderr by default', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger({ level: 'info' });
    logger.info('ready');
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it('filters below the configured level', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', write: (line) => lines.push(line) });
    logger.debug('nope');
    logger.info('nope');
    logger.warn('yes');
    logger.error('yes');
    expect(lines).toHaveLength(2);
  });

  it('redacts registered secrets from messages and meta', () => {
    registerSecrets(['hunter-key-1234567890']);
    const lines: string[] = [];
    const logger = createLogger({ level: 'info', write: (line) => lines.push(line) });
    logger.info('failed with hunter-key-1234567890', { key: 'hunter-key-1234567890' });
    expect(lines[0]).not.toContain('hunter-key-1234567890');
    expect(lines[0]).toContain('***');
  });

  it('ignores secrets shorter than 8 characters', () => {
    registerSecrets(['short']);
    expect(redact('value=short')).toBe('value=short');
  });
});
