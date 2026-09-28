// Automated regression coverage for the interactive composition-editor demo
// (tests/fixtures/editor-demo/, scripts/build-editor-demo.cjs), which
// proves docs/claude-handoff.md gate D's acceptance line ("a small example
// edits props, nests components, saves/reloads a composition, and renders
// equivalent output") for real, interactively, in a browser - see
// docs/baseline.md "Interactive browser verification" for that transcript.
//
// This file follows the exact same split tests/bundle.test.cjs already
// documents for the gate-C independent-host fixture: the Browser-pane tool
// used for real interactive verification during development is not
// invokable from a plain `node --test` process, so it cannot be the
// automated regression check. What CAN run here, and does:
//
//   1. The real CLI (`forge codegen` then `forge bundle`, through the same
//      source-loader pattern every other CLI-driving test file in this
//      suite uses) against forge.demo.config.ts, producing a real
//      metadata.json + bundle.js from the real Greeter/Card fixture
//      components.
//   2. scripts/build-editor-demo.cjs's `buildEditorDemo`, bundling the real
//      demo.tsx entry point into a single browser ESM file.
//   3. Static inspection of that built demo bundle - the same
//      "grep for compiler-tooling markers, and assert every remaining
//      `import` specifier is one of the declared host-provided peers"
//      pattern tests/bundle.test.cjs already applies to the component
//      bundle - proving the demo bundle is genuinely self-contained (no
//      esbuild/ts-morph/typescript leaking into browser output) and that
//      @reactive-forge/editor/runtime/schema were actually inlined (bundled
//      in), not left as unresolvable bare specifiers.
//
// What this file does NOT cover, on purpose: it does not click a button,
// type into an input, or assert on rendered pixels/DOM state - there is no
// jsdom/react-test-renderer in this repo (see docs/baseline.md's repeated
// notes on this constraint for renderToStaticMarkup) and the Browser pane
// tool that performed the real interactive proof is a development-time tool
// for this environment, not a `node --test` dependency. A future change
// that silently breaks the demo *build* (e.g. an editor/runtime API this
// entry point relies on getting renamed) is what this guards against; a
// future change that breaks the demo's *interactive behavior* would need a
// fresh manual/Browser-pane verification pass, same as the gate-C/D/E
// fixtures already document.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, 'tests', 'fixtures', 'editor-demo');
const outDemoDir = path.join(fixtureDir, 'out-demo');
const demoBundlePath = path.join(fixtureDir, 'demo.js');

function runCli(args, cwd) {
  // Same invocation pattern as tests/bundle.test.cjs/tests/editor.test.cjs's
  // runCli: requires bin.ts through the CommonJS test source loader (bin.ts's
  // package.json has "type": "module", so a ".ts" main-entry file would
  // otherwise be treated as native ESM before the test-only
  // Module._extensions['.ts'] hook takes effect).
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

function cleanGenerated() {
  assert.equal(path.dirname(outDemoDir), fixtureDir, 'Cleanup must remain directly inside the editor-demo fixture');
  assert.equal(path.basename(outDemoDir), 'out-demo', "Cleanup must target this fixture's own out-demo directory");
  fs.rmSync(outDemoDir, { recursive: true, force: true });
  fs.rmSync(demoBundlePath, { force: true });
  fs.rmSync(`${demoBundlePath}.map`, { force: true });
}

test('editor demo: forge codegen/bundle + build-editor-demo produce a self-contained browser demo bundle', async () => {
  cleanGenerated();
  try {
    const codegenResult = runCli(['codegen', '--config', 'forge.demo.config.ts'], fixtureDir);
    assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);

    const bundleResult = runCli(['bundle', '--config', 'forge.demo.config.ts'], fixtureDir);
    assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

    const registryBundlePath = path.join(outDemoDir, 'bundle.js');
    const metadataPath = path.join(outDemoDir, 'metadata.json');
    assert.ok(fs.existsSync(registryBundlePath), 'forge bundle produced out-demo/bundle.js');
    assert.ok(fs.existsSync(metadataPath), 'forge codegen produced out-demo/metadata.json');

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.equal(metadata.schemaVersion, 1);
    for (const name of ['Card', 'Greeter']) {
      assert.ok(metadata.components.some((c) => c.name === name), `metadata.json describes ${name}, which demo.tsx depends on`);
    }

    // --- Build the demo application bundle itself ---
    const { buildEditorDemo, hostProvidedPeers } = require(path.join(root, 'scripts', 'build-editor-demo.cjs'));
    const written = await buildEditorDemo({
      entry: path.join(fixtureDir, 'demo.tsx'),
      outfile: demoBundlePath,
    });
    assert.equal(written, demoBundlePath);
    assert.ok(fs.existsSync(demoBundlePath), 'build-editor-demo.cjs produced demo.js');

    const demoBundleText = fs.readFileSync(demoBundlePath, 'utf8');

    // --- Compiler/editor tooling must be absent from the browser bundle,
    // same static-inspection pattern tests/bundle.test.cjs already applies
    // to the component-registry bundle. ---
    for (const forbidden of ['ts-morph', 'esbuild', 'typescript/lib', 'createProgram', 'require("fs")', "require('fs')"]) {
      assert.ok(!demoBundleText.includes(forbidden), `demo bundle must not contain compiler/editor tooling marker: ${forbidden}`);
    }

    // --- @reactive-forge/editor, @reactive-forge/runtime, and
    // @reactive-forge/schema must be bundled IN (their source text
    // fingerprints should appear inline), not left as unresolved bare
    // specifiers a browser could never load. ---
    assert.ok(!demoBundleText.includes('"@reactive-forge/editor"'), '@reactive-forge/editor must be bundled in, not a literal import specifier');
    assert.ok(!demoBundleText.includes('"@reactive-forge/runtime"'), '@reactive-forge/runtime must be bundled in, not a literal import specifier');
    assert.ok(!demoBundleText.includes('"@reactive-forge/schema"'), '@reactive-forge/schema must be bundled in, not a literal import specifier');
    // A fingerprint of real bundled-in editor/runtime logic (not something a
    // trivial "does the file exist" check could pass by accident).
    assert.ok(demoBundleText.includes('useComponentPreview'), 'the real useComponentPreview implementation is bundled into demo.js');
    assert.ok(demoBundleText.includes('renderComposition'), 'the real renderComposition implementation is bundled into demo.js');

    // --- Every import statement left in the bundled ESM output must be one
    // of the declared host-provided peers - nothing else. This also proves
    // no relative/workspace-package specifier survives unresolved (esbuild
    // only leaves an `import` statement in ESM output for a specifier
    // explicitly marked external). ---
    const importSpecifiers = [...demoBundleText.matchAll(/^import\s+(?:[^"']+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
    assert.ok(importSpecifiers.length > 0, 'demo bundle keeps at least the external react imports as literal import statements');
    const allowed = new Set(hostProvidedPeers);
    for (const specifier of importSpecifiers) {
      assert.ok(allowed.has(specifier), `unexpected non-external import left in demo bundle: ${specifier}`);
    }
  } finally {
    cleanGenerated();
  }
});
