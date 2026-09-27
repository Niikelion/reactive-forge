const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs')).sort();
const result = spawnSync(process.execPath, ['--require', './tests/source-loader.cjs', '--test', ...files.map(name => `tests/${name}`)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, FORGE_STRICT_REGRESSIONS: process.argv.includes('--strict') ? '1' : '0' },
});
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
