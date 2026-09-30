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
    assert.ok(!bundleText.includes('"../'), 'no relative source-project import survives in the bundled output');

    // --- Asset loaders (image/font extensions, closing the previously
    // documented gap - see packages/codegen/src/bundle.ts's assetLoaders) ---
    // Every emitted output file besides bundle.js/bundle.css/index.ts/
    // metadata.json/__reactive_forge_files is one of esbuild's "file"-loader
    // asset copies (Branded.tsx's logo.png + Branded.css's branded-font.ttf,
    // see tests/fixtures/bundle-project/src/components/Branded.{tsx,css}).
    const nonAssetOutputs = new Set(['bundle.js', 'bundle.css', 'index.ts', 'metadata.json', '__reactive_forge_files']);
    const assetFileNames = fs.readdirSync(fixtureOutDir).filter(name => !nonAssetOutputs.has(name));
    assert.ok(assetFileNames.some(name => /^logo-.*\.png$/.test(name)), 'a hashed copy of logo.png was written to the output directory');
    assert.ok(assetFileNames.some(name => /^branded-font-.*\.ttf$/.test(name)), 'a hashed copy of branded-font.ttf was written to the output directory');

    // The asset files are genuinely present with real content, not just
    // referenced by name (a PNG's magic bytes, a TTF's sfnt version tag).
    const logoFile = assetFileNames.find(name => /^logo-.*\.png$/.test(name));
    const logoBytes = fs.readFileSync(path.join(fixtureOutDir, logoFile));
    assert.deepEqual([...logoBytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'emitted logo file is a real PNG (correct magic bytes)');
    const fontFile = assetFileNames.find(name => /^branded-font-.*\.ttf$/.test(name));
    const fontBytes = fs.readFileSync(path.join(fixtureOutDir, fontFile));
    assert.equal(fontBytes.readUInt32BE(0), 0x00010000, 'emitted font file is a real sfnt/TrueType font (correct version tag)');

    // bundle.js was actually rewritten by esbuild to reference the hashed
    // output filename, not the original source-relative path - proving a
    // real loader rewrite happened rather than assets coincidentally ending
    // up alongside the bundle.
    assert.ok(!bundleText.includes('"./logo.png"'), 'bundle.js must not reference the original, unhashed source asset path');
    assert.ok(bundleText.includes(`"./${logoFile}"`), 'bundle.js must reference the actual hashed logo filename esbuild emitted');

    // Every remaining relative string literal left in bundle.js is one of
    // the known emitted asset filenames (the "file" loader's own rewritten
    // reference) - refines, rather than removes, the prior blanket "no
    // relative path survives" check now that legitimate asset references
    // exist (they didn't when that check was first written).
    const relativeStringLiterals = [...bundleText.matchAll(/["'](\.\/[^"']*)["']/g)].map(m => m[1]);
    assert.ok(relativeStringLiterals.length > 0, 'bundle.js contains at least one rewritten relative asset reference');
    for (const literal of relativeStringLiterals) {
      const name = literal.slice(2);
      assert.ok(assetFileNames.includes(name), `unexpected relative reference left in bundle.js: ${literal} (not a known emitted asset)`);
    }

    // bundle.css: both the @font-face url() and the background-image url()
    // must have been rewritten to the same hashed asset filenames - proving
    // esbuild's CSS loader, not just its JS loader, performs the rewrite.
    const cssPath = path.join(fixtureOutDir, 'bundle.css');
    assert.ok(fs.existsSync(cssPath), 'bundle.css sibling was produced (Branded.css is reached from Branded.tsx)');
    const cssText = fs.readFileSync(cssPath, 'utf8');
    assert.ok(cssText.includes('@font-face'), 'bundle.css keeps the @font-face rule');
    assert.ok(cssText.includes(`url("./${fontFile}")`), 'bundle.css @font-face references the actual hashed font filename esbuild emitted');
    assert.ok(cssText.includes(`url("./${logoFile}")`), 'bundle.css background-image references the actual hashed logo filename esbuild emitted');
    assert.ok(!cssText.includes('branded-font.ttf"'), 'bundle.css must not reference the original, unhashed source font path');

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

    // Registry lookup by the stable metadata id (docs/baseline.md's "Known
    // gap", now fixed): the registry entry's own `id` must match
    // metadata.json's id for the same component, and a host must be able to
    // resolve purely by id, not by matching path/name heuristics.
    assert.equal(file.components.Greeter.id, target.id, 'registry entry id matches metadata.json id for the same component');
    let entry;
    for (const candidateFile of registry.components.files) {
      for (const candidate of Object.values(candidateFile.components)) {
        if (candidate.id === target.id) entry = candidate;
      }
    }
    assert.ok(entry, 'a registry entry can be found purely by metadata id');
    const Component = entry.component;
    assert.equal(typeof Component, 'function');

    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(React.createElement(Component, { name: 'Node Host', times: 2 }));
    assert.equal(html, '<div data-testid="greeter"><span>Hello, Node Host!</span><span>Hello, Node Host!</span></div>');

    // Real render of the asset-using component too: proves the rewritten
    // `logo_default` import (the "file"-loader output, asserted above) is a
    // usable string value at render time, not just present in the source
    // text.
    const brandedFile = registry.components.files.find(f => f.path.endsWith('Branded'));
    assert.ok(brandedFile, 'registry contains the Branded file entry');
    const BrandedComponent = brandedFile.components.Branded.component;
    const brandedHtml = renderToStaticMarkup(React.createElement(BrandedComponent, { label: 'Asset Proof' }));
    // React's DOM renderer auto-emits an image preload <link> ahead of an
    // <img> during server rendering - unrelated to the asset-loader proof,
    // expected here rather than suppressed.
    assert.equal(
      brandedHtml,
      `<link rel="preload" as="image" href="./${logoFile}"/><div data-testid="branded" class="branded"><img data-testid="branded-logo" src="./${logoFile}" alt="" width="1" height="1"/><span data-testid="branded-label">Asset Proof</span></div>`
    );
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
