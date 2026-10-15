import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  // Prompt templates are Markdown files bundled as strings.
  loader: { '.md': 'text' },
});
