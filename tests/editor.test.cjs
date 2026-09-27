// Gate D, part 2 (docs/claude-handoff.md section D): "add the preview hook
// and replaceable schema-driven controls", proving the full acceptance bar
// for the whole gate: "a small example edits props, nests components,
// saves/reloads a composition, and renders equivalent output. Runtime works
// independently of the editor."
//
// Reuses the exact real-bundle-plus-metadata pipeline tests/runtime.test.cjs
// already proves (`forge codegen` then `forge bundle` against
// tests/fixtures/bundle-project/, via its own forge.editor.config.ts/
// out-editor to avoid racing other test files' output directories), then
// drives @reactive-forge/editor (packages/editor/src) on top of the real
// generated bundle.js + metadata.json.
//
// No jsdom/react-test-renderer is available in this repo (see
// docs/baseline.md, "Runtime (gate D, part 1)" for the same constraint on
// `renderToStaticMarkup`). A prop *edit* can't be simulated as a real DOM
// event without one. Per the handoff's explicit permission to use judgment
// here: this test exercises the hook's pure update/re-render core directly -
// `setPropAtPath` (the exact function `useComponentPreview`'s `updateProp`
// calls) and `computePreviewState` (the exact function the hook re-runs on
// every document change) - and separately proves a control's *commit* path
// (`commitValue`, which every default control's onChange handler calls
// before producing a new prop value) end to end. `renderToStaticMarkup` is
// still used to prove the hook + controls compose into real markup for a
// single static render (a valid, non-interactive React render pass).
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const fixtureProject = path.join(root, 'tests', 'fixtures', 'bundle-project');
const fixtureOutDir = path.join(fixtureProject, 'out-editor');

const runtime = require(path.join(root, 'packages', 'runtime', 'src', 'index.ts'));
const editor = require(path.join(root, 'packages', 'editor', 'src', 'index.ts'));

function runCli(args, cwd) {
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
  assert.equal(path.basename(target), 'out-editor', "Cleanup must target this file's own out-editor directory");
  fs.rmSync(target, { recursive: true, force: true });
}

test('editor adapter: preview hook + default controls edit props, nest components, save/reload, and match bare runtime output', async () => {
  cleanFixtureOutput();
  try {
    const codegenResult = runCli(['codegen', '--config', 'forge.editor.config.ts'], fixtureProject);
    assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
    const bundleResult = runCli(['bundle', '--config', 'forge.editor.config.ts'], fixtureProject);
    assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

    const bundlePath = path.join(fixtureOutDir, 'bundle.js');
    const metadataPath = path.join(fixtureOutDir, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const registry = (await import(pathToFileURL(bundlePath).href)).components;

    const cardMeta = metadata.components.find(c => c.name === 'Card');
    const greeterMeta = metadata.components.find(c => c.name === 'Greeter');
    assert.ok(cardMeta, 'metadata.json describes Card');
    assert.ok(greeterMeta, 'metadata.json describes Greeter');

    // --- Build a nested composition: Card wrapping Greeter as a child, a
    // callback-reference prop, exactly like tests/runtime.test.cjs's document. ---
    const initialDoc = {
      schemaVersion: 1,
      root: {
        kind: 'instance',
        id: cardMeta.id,
        props: {
          title: { kind: 'value', value: { type: 'string', value: 'Greetings' } },
          onRender: { kind: 'callback', name: 'onCardRender' },
        },
        children: [
          {
            kind: 'instance',
            id: greeterMeta.id,
            props: {
              name: { kind: 'value', value: { type: 'string', value: 'Composed Host' } },
              times: { kind: 'value', value: { type: 'number', value: 1 } },
            },
          },
        ],
      },
    };
    const renderCalls = [];
    const callbacks = { onCardRender: () => renderCalls.push(true) };

    // --- computePreviewState is the exact function useComponentPreview
    // re-runs on every document change; prove it validates + renders. ---
    const initialState = editor.computePreviewState(initialDoc, metadata, registry, callbacks);
    assert.equal(initialState.validation.valid, true, JSON.stringify(initialState.validation.diagnostics));
    assert.ok(initialState.element, 'a valid document renders a live element');

    const { renderToStaticMarkup } = require('react-dom/server');
    const htmlBefore = renderToStaticMarkup(initialState.element);
    assert.match(htmlBefore, /<h2>Greetings<\/h2>/);
    assert.match(htmlBefore, /Hello, Composed Host!/);

    // --- Edit a prop THROUGH a control's real commit path. StringControl's
    // onChange handler (packages/editor/src/controls/StringControl.ts) does
    // exactly this: build a candidate ValueJson from the widget's raw input,
    // then commitValue() it (schemaFromJson + fromValueJson + toValueJson -
    // the same validated path every control uses, never a hand-rolled
    // bypass). Reused here directly since no DOM exists to fire a real input
    // event against. ---
    const nameSchema = greeterMeta.props.name.schema;
    const committedName = editor.commitValue(nameSchema, { type: 'string', value: 'Edited Host' });
    assert.deepEqual(committedName, { type: 'string', value: 'Edited Host' });

    // A value that doesn't satisfy the schema must be rejected by the same path.
    assert.throws(() => editor.commitValue(nameSchema, { type: 'number', value: 1 }));

    // --- Apply the edit via setPropAtPath - the exact function
    // useComponentPreview's `updateProp` calls - targeting the nested
    // Greeter instance (path [0]: Card's first child). ---
    const editedDoc = editor.setPropAtPath(initialDoc, [0], 'name', { kind: 'value', value: committedName });
    assert.notDeepEqual(editedDoc, initialDoc, 'setPropAtPath does not mutate the original document');
    assert.deepEqual(editor.getNodeAtPath(editedDoc, [0]).props.name.value, committedName);

    const editedState = editor.computePreviewState(editedDoc, metadata, registry, callbacks);
    assert.equal(editedState.validation.valid, true, JSON.stringify(editedState.validation.diagnostics));
    const htmlAfterEdit = renderToStaticMarkup(editedState.element);
    assert.match(htmlAfterEdit, /Hello, Edited Host!/, 'the edited prop value is reflected in the re-rendered output');
    assert.doesNotMatch(htmlAfterEdit, /Composed Host/, 'the old value is gone after the edit');
    assert.notEqual(htmlAfterEdit, htmlBefore, 'rendered output actually changed as a result of the prop edit');

    // --- Render the hook + a default control through real React, for real
    // markup (a single static pass - see module doc comment for why this,
    // not a simulated interaction, is the harness's contract). ---
    const { createElement } = require('react');
    function PreviewHarness({ document }) {
      const preview = editor.useComponentPreview({ metadata, library: registry, initialDocument: document, callbacks });
      const titleControl = createElement(editor.PropControl, {
        propMeta: cardMeta.props.title,
        currentValue: preview.targetNode.props.title,
        callbacks,
        onChange: () => {},
      });
      return createElement('div', { 'data-testid': 'harness' }, [
        createElement('div', { key: 'control', 'data-testid': 'control' }, titleControl),
        createElement('div', { key: 'preview', 'data-testid': 'preview' }, preview.element),
      ]);
    }
    const harnessHtml = renderToStaticMarkup(createElement(PreviewHarness, { document: editedDoc }));
    assert.match(harnessHtml, /data-control="string"/, 'the default string control rendered for the title prop');
    assert.match(harnessHtml, /Hello, Edited Host!/, 'the hook rendered the live preview element inline with the control');

    // A function-typed prop's control offers the host callback registry's names, never a text/code input.
    const functionControlHtml = renderToStaticMarkup(createElement(editor.PropControl, {
      propMeta: cardMeta.props.onRender,
      currentValue: initialDoc.root.props.onRender,
      callbacks,
      onChange: () => {},
    }));
    assert.match(functionControlHtml, /data-control="function"/);
    assert.match(functionControlHtml, /onCardRender/);

    // A void/never/undefined-shaped prop and reactNode both render as explicitly non-editable, never crash.
    for (const schema of [{ type: 'void' }, { type: 'never' }, { type: 'undefined' }, { type: 'reactNode' }, { type: 'unknown' }]) {
      const html = renderToStaticMarkup(createElement(editor.PropControl, {
        propMeta: { schema, required: false, diagnostics: [] },
        currentValue: undefined,
        onChange: () => { throw new Error('must never be called for a non-editable control'); },
      }));
      assert.match(html, /not editable/);
    }

    // --- Save/reload: plain JSON round trip must render identically,
    // exactly like tests/runtime.test.cjs proves for the bare runtime. ---
    const reloaded = JSON.parse(JSON.stringify(editedDoc));
    assert.deepEqual(reloaded, editedDoc);
    const reloadedState = editor.computePreviewState(reloaded, metadata, registry, callbacks);
    const htmlAfterReload = renderToStaticMarkup(reloadedState.element);
    assert.equal(htmlAfterReload, htmlAfterEdit, 'render output is identical before and after save/reload');

    // --- "Runtime works independently of the editor": render the exact same
    // reloaded document through bare @reactive-forge/runtime, importing
    // nothing from the editor package for this specific render, and diff
    // against what the editor package produced above. ---
    const bareElement = runtime.renderComposition(reloaded, metadata, registry, { callbacks });
    const bareHtml = renderToStaticMarkup(bareElement);
    assert.equal(bareHtml, htmlAfterReload, 'bare @reactive-forge/runtime renders the exact same document to the exact same output the editor package produced');
  } finally {
    cleanFixtureOutput();
  }
});
