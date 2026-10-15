// Fails if `npm pack` would publish anything other than the expected files.
import { execFileSync } from 'node:child_process';

const EXPECTED = ['LICENSE', 'README.md', 'dist/cli.js', 'package.json'];

const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = pack.files.map((file) => file.path).sort();

const unexpected = files.filter((file) => !EXPECTED.includes(file));
const missing = EXPECTED.filter((file) => !files.includes(file));

if (unexpected.length || missing.length) {
  process.stderr.write(
    `npm pack contents are wrong.\n  unexpected: ${unexpected.join(', ') || '-'}\n  missing: ${missing.join(', ') || '-'}\n`,
  );
  process.exit(1);
}
process.stderr.write(`npm pack OK: ${files.join(', ')} (${pack.size} bytes packed)\n`);
