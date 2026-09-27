// Gate C: "Prove portable consumption" (docs/claude-handoff.md section C).
// Exercises the real CLI end to end - `forge codegen` then `forge bundle` -
// against tests/fixtures/bundle-project/, then inspects the actual built
// bundle.js the way the acceptance bar requires ("Inspect actual built
// artifacts ... rather than relying only on snapshots or typechecking").
//
// A real browser render of this exact fixture (tests/fixtures/independent-host/)
// was additionally verified interactively through the Claude Code Browser
// pane tool during development - see docs/baseline.md "Portable bundle
// (gate C)" for that transcript. That tool is not invokable from a plain
// `node --test` process, so this automated file proves the same claims a
// different, reproducible way: a Node-based render using `react-dom/server`
// (the handoff's documented fallback - "run the bundle in Node with a
// DOM-shimming approach ... that still proves the bundle imports zero
// source-project files and renders real output") plus static inspection of
// the bundle text for excluded/leaked code.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const fixtureProject = path.join(root, 'tests', 'fixtures', 'bundle-project');
const fixtureOutDir = path.join(fixtureProject, 'out');

function runCli(args, cwd) {
  // Same invocation pattern as tests/cli.test.cjs's runRealCli: requires
  // bin.ts through the CommonJS source loader (not as node's main entry
  // file), because bin.ts's package.json has "type": "module" and a ".ts"
  // main-entry file would be treated as native ESM before our test-only
  // `Module._extensions['.ts']` hook takes effect.
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
  assert.equal(path.dirname(target), fixtureProject, 'Cleanup must remain directly inside the bundle-project fixture');
  assert.equal(path.basename(target), 'out', 'Cleanup must target the fixture out directory');
  fs.rmSync(target, { recursive: true, force: true });
}

test('forge bundle produces a standalone browser ESM bundle that excludes unrelated code and compiler tooling', async () => {
  cleanFixtureOutput();
  try {
    const codegenResult = runCli(['codegen'], fixtureProject);
    assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);

    const bundleResult = runCli(['bundle'], fixtureProject);
    assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

    const bundlePath = path.join(fixtureOutDir, 'bundle.js');
    const metadataPath = path.join(fixtureOutDir, 'metadata.json');
    assert.ok(fs.existsSync(bundlePath), 'bundle.js was produced');
    assert.ok(fs.existsSync(metadataPath), 'metadata.json sits next to the bundle, unchanged by bundling');

    const bundleText = fs.readFileSync(bundlePath, 'utf8');

    // --- Exclusion: unrelated application entry code is not pulled in ---
    // src/app-entry.tsx sits outside forge.config.ts's componentRoots
    // (./src/components only) and is never imported by the generated
    // registry, so esbuild's entry-point-driven bundling must never reach
    // it.
    assert.ok(
      !bundleText.includes('UNRELATED_APP_ENTRY_MARKER'),
      'unrelated application entry code (src/app-entry.tsx) must not appear in the bundle'
    );

    // --- Exclusion: compiler/editor tooling is absent from the browser bundle ---
    for (const forbidden of ['ts-morph', 'esbuild', 'typescript/lib', 'createProgram', 'require("fs")', "require('fs')"]) {
      assert.ok(!bundleText.includes(forbidden), `bundle must not contain compiler/editor tooling marker: ${forbidden}`);
    }

    // --- React/ReactDOM are external, not inlined ---
    // Every import statement remaining in the bundled output must be one of
    // the host-provided peers bundleLibrary() marks external - nothing else,
    // which also proves no relative/source-project file path survives as a
    // load-time reference (esbuild would only leave an `import` statement in
    // ESM output for a specifier explicitly marked external).
    const importSpecifiers = [...bundleText.matchAll(/^import\s+(?:[^"']+from\s+)?["']([^"']+)["']/gm)].map(m => m[1]);
    assert.ok(importSpecifiers.length > 0, 'bundle keeps at least the external react imports as literal import statements');
    const allowed = new Set(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client']);
    for (const specifier of importSpecifiers) {
      assert.ok(allowed.has(specifier), `unexpected non-external import left in bundle: ${specifier}`);
    }
    assert.ok(!bundleText.includes('"./'), 'no relative source-project import survives in the bundled output');
    assert.ok(!bundleText.includes('"../'), 'no relative source-project import survives in the bundled output');

    // --- Real render, proven in Node (fallback per docs/claude-handoff.md
    // gate C: "run the bundle in Node with a DOM-shimming approach ... that
    // still proves the bundle imports zero source-project files and renders
    // real output"). Imports the built bundle.js as real ESM - only
    // bare-specifier imports resolve (react/react-dom, from node_modules),
    // nothing under tests/fixtures/bundle-project/src is touched.
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.equal(metadata.schemaVersion, 1);
    const target = metadata.components.find(c => c.name === 'Greeter');
    assert.ok(target, 'metadata.json describes the Greeter component');
    assert.equal(typeof target.id, 'string');
    assert.ok(target.id.length > 0, 'component has a stable metadata id');

    const registry = await import(pathToFileURL(bundlePath).href);
    const file = registry.components.files.find(f => f.path.endsWith('Greeter'));
    assert.ok(file, 'registry contains the Greeter file entry');
    const Component = file.components.Greeter.component;
    assert.equal(typeof Component, 'function');

    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(React.createElement(Component, { name: 'Node Host', times: 2 }));
    assert.equal(html, '<div data-testid="greeter"><span>Hello, Node Host!</span><span>Hello, Node Host!</span></div>');
  } finally {
    cleanFixtureOutput();
  }
});

test('forge bundle fails loudly (not silently) when the registry has not been generated yet', () => {
  cleanFixtureOutput();
  try {
    fs.mkdirSync(fixtureOutDir, { recursive: true });
    const result = runCli(['bundle'], fixtureProject);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Run "forge codegen" before "forge bundle"/);
  } finally {
    cleanFixtureOutput();
  }
});
