const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
function runCli(loaderBody) {
  const launch = `
const Module = require('node:module');
const original = Module._load;
Module._load = function(request, ...args) {
  if (request === 'load-config-ts') return { loadConfig: async () => { ${loaderBody} } };
  return original.call(this, request, ...args);
};
process.argv = [process.execPath, 'forge', 'codegen'];
delete process._eval;
process.execArgv = [];
require('./packages/codegen/src/bin.ts');
`;
  const result = spawnSync(process.execPath, ['--require', './tests/source-loader.cjs', '-e', launch], { cwd: root, encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}

test('C01: missing config fails with one error and nonzero exit status', () => {
  const result = runCli('return { path: undefined, data: undefined };');
  assert.notEqual(result.status, 0);
  assert.equal((result.stdout + result.stderr).match(/Could not load config/g)?.length, 1);
});

test('C01: config-loader rejection fails with one error and nonzero exit status', () => {
  const result = runCli("throw new Error('fixture config loading failed');");
  assert.notEqual(result.status, 0);
  assert.equal((result.stdout + result.stderr).match(/fixture config loading failed/g)?.length, 1);
});

test('C01: codegen rejection fails with one error and nonzero exit status', () => {
  const directory = fs.mkdtempSync(path.join(root, '.cache-forge-generation-'));
  try {
    const sourceRoot = path.join(directory, 'src');
    const outDir = path.join(directory, 'out');
    fs.mkdirSync(sourceRoot);
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(sourceRoot, 'entry.tsx'), 'export const Entry = () => <div />;\n');
    const tsConfigFilePath = path.join(directory, 'tsconfig.json');
    fs.writeFileSync(tsConfigFilePath, JSON.stringify({
      compilerOptions: { strict: true, jsx: 'react-jsx', target: 'esnext', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true },
      include: ['src/**/*'],
    }));
    fs.writeFileSync(path.join(outDir, 'index.ts'), 'const userContent = true;\n');
    const config = {
      tsConfigFilePath, typescriptLibPath: path.join(root, 'node_modules/typescript/lib'),
      componentRoots: [sourceRoot], outDir, rootDir: sourceRoot, baseDir: sourceRoot,
      pathPrefix: 'fixture/',
    };
    const result = runCli(`return { path: 'forge.config.ts', data: ${JSON.stringify(config)} };`);
    assert.notEqual(result.status, 0);
    assert.equal((result.stdout + result.stderr).match(/Refusing to overwrite/g)?.length, 1);
  } finally {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), root, 'Cleanup must remain directly inside the workspace');
    assert.ok(path.basename(target).startsWith('.cache-forge-generation-'), 'Cleanup must target a generated test directory');
    fs.rmSync(target, { recursive: true, force: true });
  }
});
