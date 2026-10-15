import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

// Self-contained server for the MCPB bundle (Smithery, Claude Desktop one-click install).
// Every dependency is inlined, so the bundle needs no node_modules.
export default defineConfig({
  entry: { index: 'src/cli.ts' },
  outDir: 'build/mcpb/server',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  noExternal: [/.*/],
  outExtension: () => ({ js: '.cjs' }),
  loader: { '.md': 'text' },
  define: { __OPENSDR_VERSION__: JSON.stringify(version) },
});
