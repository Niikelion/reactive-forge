// Automated regression coverage for the interactive composition-editor demo
// (tests/fixtures/editor-demo/, tests/support/build-editor-demo.cjs), which
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
//   2. tests/support/build-editor-demo.cjs's `buildEditorDemo`, bundling the real
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
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, 'tests', 'fixtures', 'editor-demo');
const outDemoDir = path.join(fixtureDir, 'out-demo');
const demoBundlePath = path.join(fixtureDir, 'demo.js');
const externalWidgetsDir = path.join(root, 'tests', 'fixtures', 'node_modules', 'rf-demo-widgets');

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
    // Phase 3: forge.demo.config.ts now sets annotationSources.colocated: true so the demo
    // gets a real schemaVersion 2 metadata.json with SlotCard's real slot rules (see
    // demo.tsx's slot outlets: actions/icon/caption).
    assert.equal(metadata.schemaVersion, 4);
    for (const name of ['SlotCard', 'SlotIcon', 'NestedSlotCard']) {
      assert.ok(metadata.components.some((c) => c.name === name), `metadata.json describes ${name}, which demo.tsx depends on`);
    }
    const slotCard = metadata.components.find((c) => c.name === 'SlotCard');
    assert.ok(Array.isArray(slotCard.slots) && slotCard.slots.length > 0, 'SlotCard has real slot rules for the demo\'s slot outlets to consume');

    // Phase 4: an externally-annotated library component (docs/slot-contract.md section 5),
    // resolved via forge.demo.config.ts's annotationSources.libraries entry pointing at
    // tests/fixtures/bundle-project/src/annotations/externalWidgets.ts, which names the real
    // fixture package tests/fixtures/node_modules/rf-demo-widgets - proves static discovery +
    // .d.ts resolution actually ran (not just that the config field parses).
    const externalLibrary = metadata.externalLibraries?.find((l) => l.package === 'rf-demo-widgets');
    assert.ok(externalLibrary, 'metadata.json describes the rf-demo-widgets external library');
    assert.equal(externalLibrary.resolvedVersion, '2.0.0');
    assert.deepEqual(externalLibrary.diagnostics, [], 'the external library resolved with zero diagnostics');
    const badgeMeta = metadata.components.find((c) => c.external?.package === 'rf-demo-widgets' && c.external.exportName === 'Badge');
    assert.ok(badgeMeta, 'metadata.json describes the external Badge component');
    assert.deepEqual(badgeMeta.external, { source: 'external', package: 'rf-demo-widgets', exportName: 'Badge', isDefault: false });
    assert.equal(badgeMeta.props.label.required, false, 'Badge.label was extracted from the real .d.ts (optional, so a bare inserted instance renders without a missing-required-prop diagnostic)');

    // The generated registry bundle (out-demo/bundle.js, produced by codegen's OWN static
    // analysis) must never contain the external package's real implementation - only demo.tsx
    // (the host application) imports it for real, per docs/slot-contract.md section 5's "never
    // require/import the runtime module" requirement.
    const registryBundleText = fs.readFileSync(registryBundlePath, 'utf8');
    assert.ok(!registryBundleText.includes('rf-demo-widgets'), 'forge bundle (codegen\'s own output) must never reference the external package - it only resolves its .d.ts, never imports/executes it');

    // --- Build the demo application bundle itself ---
    const { buildEditorDemo, hostProvidedPeers } = require(path.join(root, 'tests', 'support', 'build-editor-demo.cjs'));
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
    // Adapter export descriptors legitimately contain module names as data.
    assert.ok(!/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']@reactive-forge\/runtime["']/.test(demoBundleText), '@reactive-forge/runtime must be bundled in, not an unresolved import');
    assert.ok(!demoBundleText.includes('"@reactive-forge/schema"'), '@reactive-forge/schema must be bundled in, not a literal import specifier');
    // A fingerprint of real bundled-in editor/runtime logic (not something a
    // trivial "does the file exist" check could pass by accident).
    assert.ok(demoBundleText.includes('useComponentPreview'), 'the real useComponentPreview implementation is bundled into demo.js');
    assert.ok(demoBundleText.includes('renderComposition'), 'the real renderComposition implementation is bundled into demo.js');
    // Phase 3: the slot-outlet code path (packages/editor/src/slots.ts) must be bundled in too -
    // proves the demo's palette filtering/drop acceptance really calls the shared
    // checkSlotValue/resolveSlotPolicy pair, not a hand-rolled duplicate.
    assert.ok(demoBundleText.includes('checkSlotValue'), 'checkSlotValue (the shared policy checker) is bundled into demo.js');
    assert.ok(demoBundleText.includes('insertSlotItem'), 'the real insertSlotItem slot operation is bundled into demo.js');
    // Phase 4: the external package's REAL implementation must be genuinely inlined into demo.js
    // (the host bundle) - a fingerprint of its actual source (not just a string a trivial stub
    // could also contain), proving demo.tsx's `import { Badge } from "rf-demo-widgets"` was really
    // resolved and bundled, not left dangling.
    assert.ok(demoBundleText.includes('external-badge'), 'the real rf-demo-widgets Badge implementation (data-testid="external-badge") is bundled into demo.js');
    assert.ok(demoBundleText.includes('exportToTsx'), 'the real exportToTsx implementation is bundled into demo.js, backing the Export to TSX button');
    assert.ok(demoBundleText.includes('CompositionEditor'), 'the reusable editor is included for the real nested demo');
    assert.ok(demoBundleText.includes('nested-editor-demo'), 'the nested demo is mounted by the browser application');

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

// ---------------------------------------------------------------------------------------------
// Phase 4 (docs/claude-slots-handoff.md "Real browser acceptance"): "Export the resulting
// composition and compare its rendered output to runtime output." This is the automated,
// Node-side half of that proof - option (b) from the coordinator's brief, mirroring the exact
// compile-and-compare pattern tests/export.test.cjs already established (ts.createProgram +
// getPreEmitDiagnostics, then a real react-dom/server render diff) - now pulling a real
// composition document that matches what a user actually builds interactively in the demo
// (SlotCard header/actions/icon/caption, with an externally-annotated `Badge` instance dropped
// into `actions`, exactly like the "Insert Badge" browser interaction recorded in docs/baseline.md).
// The interactive/visual half of the same proof is demo.tsx's own "Export to TSX" button
// (data-testid="btn-export" / "export-output"), verified separately by hand in a real browser
// (see docs/baseline.md's phase 4 section for that transcript).

function compileTsx(scratchDir, filePaths) {
  const fixtureTsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'bundle-project', 'tsconfig.json'), 'utf8'));
  const { options: compilerOptions, errors: optionErrors } = ts.convertCompilerOptionsFromJson(fixtureTsconfig.compilerOptions, scratchDir);
  assert.deepEqual(optionErrors, [], 'tsconfig.json compiler options parse cleanly');
  const program = ts.createProgram(filePaths, compilerOptions);
  const normalizedTargets = new Set(filePaths.map((p) => p.replace(/\\/g, '/')));
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file && normalizedTargets.has(d.file.fileName));
  if (diagnostics.length > 0) {
    return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => scratchDir,
      getNewLine: () => '\n',
    });
  }
  return null;
}

test('editor demo phase 4: exportToTsx of the demo\'s live document (SlotCard + external Badge in actions) renders the real component, and the export path\'s external-identity limitation is real and documented', async () => {
  cleanGenerated();
  try {
    const codegenResult = runCli(['codegen', '--config', 'forge.demo.config.ts'], fixtureDir);
    assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
    const bundleResult = runCli(['bundle', '--config', 'forge.demo.config.ts'], fixtureDir);
    assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

    const metadata = JSON.parse(fs.readFileSync(path.join(outDemoDir, 'metadata.json'), 'utf8'));
    const registryModule = await import(pathToFileURL(path.join(outDemoDir, 'bundle.js')).href);
    const projectRegistry = registryModule.components;
    const richId = metadata.components.find(c => c.name === 'RichContent').id;

    const byName = (name) => {
      const found = metadata.components.find((c) => c.name === name);
      assert.ok(found, `expected component ${name} in metadata.json`);
      return found;
    };
    const slotCardMeta = byName('SlotCard');
    const slotIconMeta = byName('SlotIcon');
    const badgeMeta = metadata.components.find((c) => c.external?.package === 'rf-demo-widgets' && c.external.exportName === 'Badge');
    assert.ok(badgeMeta, 'expected the external Badge component in metadata.json');

    // The demo's own host-side registry augmentation (demo.tsx's withExternalLibraryEntries):
    // the generated registry never contains an external component's real implementation, so the
    // HOST supplies its own real import, exactly like a production app would. Real dynamic import
    // of the real fixture package (not a stub), matching demo.tsx's own import.
    const { Badge } = await import(pathToFileURL(path.join(externalWidgetsDir, 'index.js')).href);
    const registry = {
      files: [
        ...projectRegistry.files,
        { path: 'external:rf-demo-widgets', components: { Badge: { id: badgeMeta.id, component: Badge, args: { type: 'object', properties: {} } } } },
      ],
    };

    const { validateComposition, renderComposition, exportToTsx } = require(path.join(root, 'packages', 'runtime', 'src', 'index.ts'));
    const { renderToStaticMarkup } = require('react-dom/server');

    // The exact document shape the "Insert Badge" browser interaction produces (docs/baseline.md):
    // SlotCard's real header/actions/icon/caption slots, actions holding one real external Badge
    // instance.
    // v3 (docs/slot-contract-recursive.md): schemaVersion 3, CompositionPropValue collapsed to
    // {kind:"callback"} / {kind:"composed", value: CompositionValue}. "actions" (ReactNode[]) is
    // a genuine DECLARED ARRAY with an each() per-entry policy - its own top-level value is
    // "array", not a flat "nodes" list; each declared entry is independently "nodes"-kind
    // (packages/editor/src/slots.ts's insertSlotItem represents the simple "one entry = one node"
    // case by giving the entry's own itemId the same value as its single inner slot item's itemId
    // - mirrored here by using "a1" for both).
    const doc = {
      schemaVersion: 3,
      root: {
        kind: 'instance',
        instanceId: 'root',
        componentId: slotCardMeta.id,
        props: {
          header: { kind: 'composed', value: { kind: 'nodes', value: { items: [{ itemId: 'h1', kind: 'text', value: 'Reactive Forge Demo' }] } } },
          actions: {
            kind: 'composed',
            value: {
              kind: 'array',
              items: [{
                itemId: 'a1',
                value: { kind: 'nodes', value: { items: [{ itemId: 'a1', kind: 'instance', instance: { kind: 'instance', instanceId: 'badge-1', componentId: badgeMeta.id, props: {} } }] } },
              }],
            },
          },
          icon: { kind: 'composed', value: { kind: 'componentRef', value: { source: 'project', id: slotIconMeta.id } } },
          caption: { kind: 'composed', value: {kind: 'nodes', value: {items: [{itemId: 'caption-item', kind: 'instance', instance: {kind: 'instance', instanceId: 'caption-host', componentId: richId, props: {text: {kind: 'composed', value: {kind: 'leaf', value: {type: 'string', value: 'Edit me'}}}}}}]}} },
        },
      },
    };

    // --- Renders for real, through the real, unmodified runtime (packages/runtime/src/render.ts) ---
    const validation = validateComposition(doc, metadata, registry, {});
    assert.deepEqual(validation.diagnostics, [], 'the document (with the external Badge instance) validates with zero diagnostics against the augmented registry');
    const runtimeHtml = renderToStaticMarkup(renderComposition(doc, metadata, registry, {}));
    assert.match(runtimeHtml, /★ External Badge/, 'the runtime render contains the real external Badge component\'s own real output text');
    assert.match(runtimeHtml, /data-source-package="rf-demo-widgets"/, 'the rendered markup carries the real Badge implementation\'s own data attribute - not a stand-in');

    // --- exportToTsx on the SAME document: proves the "nodes"-item path DOES serialize an
    // external instance as real JSX (<Badge ... />), which is new coverage no existing fixture
    // exercised (tests/export.test.cjs's own external-identity coverage is componentRef-only). ---
    const tsxSource = exportToTsx(doc, metadata, registry);
    assert.match(tsxSource, /<Badge\s*\/>/, 'the external Badge instance serializes as real JSX, not dropped or stubbed');
    assert.match(tsxSource, /import \{ Badge \} from/, 'an import statement naming Badge is generated for the external "nodes"-item instance');

    // --- Fixed (was a real, documented bug found by this phase's own demo work):
    // packages/runtime/src/export.ts's collectInstanceComponentIds previously recorded every
    // "nodes"-slot instance as `{source: "project", id: node.componentId}` unconditionally, never
    // checking whether that componentId's ComponentMetadata entry had `.external` set - unlike the
    // componentRef/element-reference paths in the same file, which already preserved source
    // correctly. Both collectInstanceComponentIds and renderInstanceJsx's matching import-table
    // lookup now resolve the real identity (instanceImportKeyAndIdentity), so the generated import
    // is the real package specifier, not a broken path built from the external component's
    // .d.ts-resolution sourcePath (which docs/slot-contract.md section 5 explicitly says is "for
    // diagnostics only, never re-derived as identity"). ---
    assert.match(
      tsxSource,
      /import \{ Badge \} from "rf-demo-widgets"/,
      'a "nodes"-slot instance referencing an external component generates the correct import specifier'
    );

    // --- The genuine positive "compiles and renders byte-identical output" proof, for the part of
    // the pipeline that IS correctly wired end to end: the same SlotCard document, with actions
    // left empty (no external instance), so exportToTsx's generated import table only references
    // project components - exactly the codepath tests/export.test.cjs's second test already
    // proves compiles, reused here against the demo's own real SlotCard/SlotIcon metadata/registry
    // instead of a hand-rolled one. ---
    const projectOnlyDoc = {
      schemaVersion: 3,
      root: {
        kind: 'instance',
        instanceId: 'root',
        componentId: slotCardMeta.id,
        props: {
          header: doc.root.props.header,
          actions: { kind: 'composed', value: { kind: 'array', items: [] } },
          icon: doc.root.props.icon,
          caption: doc.root.props.caption,
        },
      },
    };
    const projectOnlyValidation = validateComposition(projectOnlyDoc, metadata, registry, {});
    assert.deepEqual(projectOnlyValidation.diagnostics, []);
    const projectOnlyRuntimeHtml = renderToStaticMarkup(renderComposition(projectOnlyDoc, metadata, registry, {}));

    const scratchDir = path.join(outDemoDir, 'export-scratch');
    fs.mkdirSync(scratchDir, { recursive: true });
    const resolveImportPath = (component) => {
      const absoluteSource = path.resolve(path.join(root, 'tests', 'fixtures'), component.sourcePath);
      const withoutExtension = absoluteSource.replace(/\.(tsx?|jsx?)$/i, '');
      const relative = path.relative(scratchDir, withoutExtension).replace(/\\/g, '/');
      return relative.startsWith('.') ? relative : `./${relative}`;
    };
    const projectOnlyTsxSource = exportToTsx(projectOnlyDoc, metadata, registry, { resolveImportPath });
    const exportedFilePath = path.join(scratchDir, 'ExportedComposition.tsx');
    fs.writeFileSync(exportedFilePath, projectOnlyTsxSource, 'utf8');

    const compileError = compileTsx(scratchDir, [exportedFilePath]);
    assert.equal(compileError, null, `Generated TSX (project-components-only) failed to typecheck:\n${compileError}`);

    const exportedComponent = require(exportedFilePath).default;
    const { createElement } = require('react');
    const exportedHtml = renderToStaticMarkup(createElement(exportedComponent, { callbacks: {} }));
    assert.equal(exportedHtml, projectOnlyRuntimeHtml, 'the exported TSX (project components only) renders byte-identical HTML to @reactive-forge/runtime\'s renderComposition for the same document');

    // Exercise the exact nested document mounted by the demo, including two nodes in one
    // declared array entry and an independent empty entry. A JSON round-trip preserves both
    // entry IDs and inner node IDs before TSX compilation/render equivalence is checked.
    const { buildNestedDocument } = require(path.join(fixtureDir, 'nested-demo.tsx'));
    const nestedDocument = buildNestedDocument(byName('NestedSlotCard').id, richId);
    const nestedRoundTrip = JSON.parse(JSON.stringify(nestedDocument));
    assert.deepEqual(nestedRoundTrip, nestedDocument);
    assert.equal(validateComposition(nestedRoundTrip, metadata, registry).valid, true);
    assert.equal(nestedRoundTrip.root.props.actions.value.items[0].value.value.items.length, 2);
    assert.equal(nestedRoundTrip.root.props.actions.value.items[1].value.value.items.length, 0);
    const nestedRuntimeHtml = renderToStaticMarkup(renderComposition(nestedRoundTrip, metadata, registry));
    const nestedExportPath = path.join(scratchDir, 'NestedExport.tsx');
    fs.writeFileSync(nestedExportPath, exportToTsx(nestedRoundTrip, metadata, registry, { resolveImportPath }), 'utf8');
    assert.equal(compileTsx(scratchDir, [nestedExportPath]), null, 'nested demo TSX typechecks');
    const NestedExport = require(nestedExportPath).default;
    assert.equal(renderToStaticMarkup(createElement(NestedExport, { callbacks: {} })), nestedRuntimeHtml,
      'nested demo save/reload/export preserves runtime output without editor outlets');
  } finally {
    cleanGenerated();
  }
});
