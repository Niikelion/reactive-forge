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

// The tests below exercise the REAL `load-config-ts` package (no mock of
// `Module._load`), including its `esbuild`-backed TypeScript bundling, against
// a tracked fixture project. This proves the built dependency chain actually
// loads a real `.ts` config file end to end, not just that the CLI reacts
// correctly to a stubbed loader.
const fixtureProject = path.join(root, 'tests', 'fixtures', 'cli-project');
const fixtureConfig = path.join(fixtureProject, 'forge.config.ts');
const fixtureOutDir = path.join(fixtureProject, 'out');

function runRealCli(args, cwd) {
  // Requires bin.ts through the CommonJS loader (like the mocked C01 cases
  // above), instead of passing it as node's main entry file: bin.ts's
  // package.json has "type": "module", and node's module-type detection for
  // a *main* script with an unrecognized ".ts" extension runs before our
  // test-only `Module._extensions['.ts']` hook takes effect, so it would be
  // loaded as native ESM (and fail on the plain JSON import) instead.
  const launch = `
process.argv = [process.execPath, 'forge', ...${JSON.stringify(args)}];
delete process._eval;
process.execArgv = [];
require(${JSON.stringify(path.join(root, 'packages', 'codegen', 'src', 'bin.ts'))});
`;
  const result = spawnSync(process.execPath, ['--require', path.join(root, 'tests', 'source-loader.cjs'), '-e', launch], {
    cwd: cwd ?? root,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  return result;
}

function cleanFixtureOutput() {
  const target = path.resolve(fixtureOutDir);
  assert.equal(path.dirname(target), fixtureProject, 'Cleanup must remain directly inside the cli-project fixture');
  assert.equal(path.basename(target), 'out', 'Cleanup must target the fixture out directory');
  fs.rmSync(target, { recursive: true, force: true });
}

test('C02: the real load-config-ts + esbuild path loads a TypeScript config, extracts a fixture, and generates a usable manifest', () => {
  cleanFixtureOutput();
  try {
    const first = runRealCli(['codegen'], fixtureProject);
    assert.equal(first.status, 0, first.stdout + first.stderr);

    const aggregatePath = path.join(fixtureOutDir, 'index.ts');
    const wrapperPath = path.join(fixtureOutDir, '__reactive_forge_files', 'src', 'entry.tsx.ts');
    assert.ok(fs.existsSync(aggregatePath), 'aggregate manifest was generated');
    assert.ok(fs.existsSync(wrapperPath), 'component wrapper was generated');

    const manifest = require(aggregatePath);
    assert.equal(manifest.components.files.length, 1);
    const byPath = Object.fromEntries(manifest.components.files.map(file => [file.path, file]));
    assert.ok(Object.hasOwn(byPath, 'fixture/entry'), 'generated manifest uses the configured pathPrefix and fixture-relative path');
    assert.ok(Object.hasOwn(byPath['fixture/entry'].components, 'Entry'));
    assert.equal(typeof byPath['fixture/entry'].components.Entry.component, 'function');

    const beforeAggregate = fs.readFileSync(aggregatePath, 'utf8');
    const beforeWrapper = fs.readFileSync(wrapperPath, 'utf8');

    const second = runRealCli(['codegen'], fixtureProject);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(fs.readFileSync(aggregatePath, 'utf8'), beforeAggregate, 'regeneration leaves the aggregate manifest byte-identical');
    assert.equal(fs.readFileSync(wrapperPath, 'utf8'), beforeWrapper, 'regeneration leaves the component wrapper byte-identical');
  } finally {
    cleanFixtureOutput();
  }
});

test('C03: config-relative paths anchor to the config file location, not the process working directory', () => {
  cleanFixtureOutput();
  try {
    // Invoked from the repository root (not the fixture directory) with an
    // absolute --config path. Every relative path inside forge.config.ts
    // (baseDir, tsConfigFilePath, outDir, ...) must still resolve against the
    // config file's own directory.
    const result = runRealCli(['codegen', '--config', fixtureConfig], root);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    assert.ok(fs.existsSync(path.join(fixtureOutDir, 'index.ts')), 'output was generated next to the config file, not the invocation cwd');
    assert.ok(!fs.existsSync(path.join(root, 'out')), 'nothing was generated relative to the process working directory');
    assert.ok(!fs.existsSync(path.join(root, 'src', 'entry.tsx')), 'sanity: repo root has no fixture source of its own');
  } finally {
    cleanFixtureOutput();
  }
});
