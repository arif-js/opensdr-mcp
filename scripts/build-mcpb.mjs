// Builds two MCP Bundles from one self-contained server (no node_modules needed):
//   opensdr-mcp.mcpb           standard bundle: one-click install in Claude Desktop, GitHub Releases
//   opensdr-mcp-smithery.mcpb  same server, manifest without the static tool list. Smithery
//                              requires an inputSchema on every listed tool, which the MCPB spec
//                              forbids, so this variant omits the list (tools_generated: true).
// Usage: npm run build:mcpb
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('mcpb/manifest.json', 'utf8'));
if (manifest.version !== version) {
  process.stderr.write(`mcpb/manifest.json version ${manifest.version} != package.json ${version}\n`);
  process.exit(1);
}

rmSync('build/mcpb', { recursive: true, force: true });
run('npx', ['tsup', '--config', 'tsup.mcpb.config.ts']);

function pack(dir, bundleManifest, output) {
  if (dir !== 'build/mcpb') cpSync('build/mcpb/server', `${dir}/server`, { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/manifest.json`, `${JSON.stringify(bundleManifest, null, 2)}\n`);
  cpSync('LICENSE', `${dir}/LICENSE`);
  cpSync('README.md', `${dir}/README.md`);
  run('npx', ['-y', MCPB_CLI, 'validate', `${dir}/manifest.json`]);
  run('npx', ['-y', MCPB_CLI, 'pack', dir, output]);
}

pack('build/mcpb', manifest, 'opensdr-mcp.mcpb');

const { tools: _tools, ...withoutTools } = manifest;
pack('build/mcpb-smithery', { ...withoutTools, tools_generated: true }, 'opensdr-mcp-smithery.mcpb');

process.stderr.write('Built opensdr-mcp.mcpb and opensdr-mcp-smithery.mcpb\n');
