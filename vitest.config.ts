import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Load prompt templates (.md) as strings, matching tsup's `text` loader.
  plugins: [
    {
      name: 'markdown-as-text',
      transform(code, id) {
        if (!id.endsWith('.md')) return null;
        return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts'],
      reportsDirectory: 'coverage',
    },
  },
});
