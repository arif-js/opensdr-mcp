// Builds opensdr-mcp.mcpb: a self-contained MCP Bundle for Smithery and one-click install in
// Claude Desktop. Usage: npm run build:mcpb
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

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
mkdirSync('build/mcpb', { recursive: true });
cpSync('mcpb/manifest.json', 'build/mcpb/manifest.json');
cpSync('LICENSE', 'build/mcpb/LICENSE');
cpSync('README.md', 'build/mcpb/README.md');

run('npx', ['-y', MCPB_CLI, 'validate', 'build/mcpb/manifest.json']);
run('npx', ['-y', MCPB_CLI, 'pack', 'build/mcpb', 'opensdr-mcp.mcpb']);
process.stderr.write('Built opensdr-mcp.mcpb\n');
