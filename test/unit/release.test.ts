import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testContext } from '../helpers/context.js';
import { linkClient } from '../helpers/mcp.js';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const server = JSON.parse(read('server.json'));

function docsFiles(dir = 'docs'): string[] {
  return readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap(
    (entry) =>
      entry.isDirectory()
        ? docsFiles(`${dir}/${entry.name}`)
        : entry.name.endsWith('.md')
          ? [`${dir}/${entry.name}`]
          : [],
  );
}

/** Every env var name the config actually reads. */
function configEnvVars(): string[] {
  return [
    ...new Set(
      read('src/config.ts').match(
        /'((?:OPENSDR|APOLLO|HUNTER|EXA|TAVILY|INSTANTLY|HUBSPOT)_[A-Z_]+)'/g,
      ) ?? [],
    ),
  ]
    .map((quoted) => quoted.slice(1, -1))
    .sort();
}

describe('release metadata', () => {
  it('README tool table lists exactly the registered tools', async () => {
    const linked = await linkClient(testContext());
    try {
      const registered = (await linked.client.listTools()).tools.map((t) => t.name).sort();
      const readme = read('README.md');
      const start = readme.indexOf('## Tools');
      const table = readme.slice(start, readme.indexOf('\n## ', start + 1));
      const documented = [...new Set(table.match(/`(sdr_[a-z_]+)`/g) ?? [])]
        .map((name) => name.slice(1, -1))
        .sort();
      expect(documented).toEqual(registered);
    } finally {
      await linked.close();
    }
  });

  it('server.json matches package.json', () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].version).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('server.json only advertises env vars the config reads', () => {
    const known = configEnvVars();
    for (const variable of server.packages[0].environmentVariables) {
      expect(known).toContain(variable.name);
    }
  });

  it('.env.example documents every env var the config reads', () => {
    const example = read('.env.example');
    for (const variable of configEnvVars()) {
      expect(example, `${variable} missing from .env.example`).toMatch(
        new RegExp(`^${variable}=`, 'm'),
      );
    }
  });

  it('docs/configuration.md documents every env var the config reads', () => {
    const docs = read('docs/configuration.md');
    for (const variable of configEnvVars()) {
      expect(docs, `${variable} missing from docs/configuration.md`).toContain(variable);
    }
  });

  it('docs/tools.md documents every registered tool', async () => {
    const linked = await linkClient(testContext());
    try {
      const docs = read('docs/tools.md');
      for (const tool of (await linked.client.listTools()).tools) {
        expect(docs, `${tool.name} missing from docs/tools.md`).toContain(`\`${tool.name}\``);
      }
    } finally {
      await linked.close();
    }
  });

  it('relative links in README and docs point to files that exist', () => {
    const files = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', ...docsFiles()];
    for (const file of files) {
      const text = read(file);
      for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const resolved = new URL(target, new URL(`../../${file}`, import.meta.url));
        expect(existsSync(resolved), `${file} links to missing ${target}`).toBe(true);
      }
    }
  });
});
