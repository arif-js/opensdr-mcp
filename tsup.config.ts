import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  // Prompt templates are Markdown files bundled as strings.
  loader: { '.md': 'text' },
  define: { __OPENSDR_VERSION__: JSON.stringify(version) },
});
