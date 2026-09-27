import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packages = [
  '@reactive-forge/schema',
  '@reactive-forge/codegen',
  '@reactive-forge/eslint-config',
];
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

function declaredFiles(value, result = []) {
  if (typeof value === 'string' && value.startsWith('./')) result.push(value);
  else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) declaredFiles(child, result);
  }
  return result;
}

for (const packageName of packages) {
  const manifestPath = resolve(root, 'packages', packageName.split('/').at(-1), 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packageRoot = dirname(manifestPath);
  const entries = [manifest.main, manifest.module, manifest.types, ...declaredFiles(manifest.exports), ...Object.values(manifest.bin ?? {})]
    .filter((entry) => typeof entry === 'string');

  for (const entry of new Set(entries)) {
    check(existsSync(resolve(packageRoot, entry)), `${packageName}: declared entry is missing: ${entry}`);
  }

  try {
    await import(packageName);
  } catch (error) {
    check(false, `${packageName}: import failed: ${error.message}`);
  }

  try {
    require(packageName);
  } catch (error) {
    check(false, `${packageName}: require failed: ${error.message}`);
  }
}

const codegenManifest = JSON.parse(readFileSync(resolve(root, 'packages/codegen/package.json'), 'utf8'));
const binPath = resolve(root, 'packages/codegen', codegenManifest.bin.forge);
const help = spawnSync(process.execPath, [binPath, '--help'], { cwd: root, encoding: 'utf8' });
check(!help.error && help.status === 0, `@reactive-forge/codegen forge --help failed${help.error ? `: ${help.error.message}` : ` (exit ${help.status})`}`);

if (errors.length) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Package exports OK: ${packages.join(', ')}; forge --help`);
}
