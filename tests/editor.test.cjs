// Gate D, part 2 (docs/claude-handoff.md section D) + phase 3 slot outlets
// (docs/claude-slots-handoff.md): "add the preview hook and replaceable
// schema-driven controls", proving the full acceptance bar for the whole
// gate: "a small example edits props, nests components, saves/reloads a
// composition, and renders equivalent output. Runtime works independently of
// the editor." Phase 3 extends this with real slot-outlet operations
// (insertion/rejection/reordering/richText/componentRef), all going through
// the SAME `checkSlotValue`/`resolveSlotPolicy` pair `packages/runtime`'s own
// validation uses (docs/slot-contract.md section 8) - see packages/editor/src/slots.ts.
//
// Documents in this file are v2-shaped (`schemaVersion: 2`,
// `CompositionInstance.instanceId`/`componentId`, `CompositionSlotItem[]`
// slot values) - migrated from the v1 shape this file used before phase 3,
// matching the pattern tests/runtime-v2.test.cjs already established for the
// bare runtime.
//
// Reuses the exact real-bundle-plus-metadata pipeline tests/runtime.test.cjs
// already proves (`forge codegen` then `forge bundle` against
// tests/fixtures/bundle-project/, via its own forge.editor.config.ts/
// out-editor to avoid racing other test files' output directories - now with
// `annotationSources.colocated: true` so SlotCard's real slot rules come
// through), then drives @reactive-forge/editor (packages/editor/src) on top
// of the real generated bundle.js + metadata.json.
//
// No jsdom/react-test-renderer is available in this repo (see
// docs/baseline.md, "Runtime (gate D, part 1)" for the same constraint on
// `renderToStaticMarkup`). A prop *edit* can't be simulated as a real DOM
// event without one. Per the handoff's explicit permission to use judgment
// here: this test exercises the hook's pure update/re-render core directly -
// `setPropAtPath` (the exact function `useComponentPreview`'s `updateProp`
// calls), `computePreviewState` (the exact function the hook re-runs on
// every document change), and every pure slot operation in slots.ts - and
// separately proves a control's *commit* path (`commitValue`, which every
// default control's onChange handler calls before producing a new prop
// value) end to end. `renderToStaticMarkup` is still used to prove the hook +
// controls compose into real markup for a single static render (a valid,
// non-interactive React render pass). Real DOM/click-driven interaction is
// covered separately in the browser demo (tests/fixtures/editor-demo/,
// tests/editor-demo.test.cjs, and docs/baseline.md's "Editor slot outlets"
// section, verified through the Browser pane tool).
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

async function buildFixture() {
  cleanFixtureOutput();
  const codegenResult = runCli(['codegen', '--config', 'forge.editor.config.ts'], fixtureProject);
  assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
  const bundleResult = runCli(['bundle', '--config', 'forge.editor.config.ts'], fixtureProject);
  assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

  const bundlePath = path.join(fixtureOutDir, 'bundle.js');
  const metadataPath = path.join(fixtureOutDir, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const registry = (await import(pathToFileURL(bundlePath).href)).components;
  return { metadata, registry };
}

function byName(metadata, name) {
  const found = metadata.components.find((c) => c.name === name);
  assert.ok(found, `expected component ${name} in metadata.json`);
  return found;
}

test('editor adapter: preview hook + default controls edit props, nest components, save/reload, and match bare runtime output', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const cardMeta = byName(metadata, 'Card');
    const greeterMeta = byName(metadata, 'Greeter');

    // --- Build a nested v2 composition: Card wrapping Greeter as a "children" nodes-slot
    // item, a callback-reference prop - exactly like tests/runtime-v2.test.cjs's document. ---
    const initialDoc = {
      schemaVersion: 2,
      root: {
        kind: 'instance',
        instanceId: 'card-1',
        componentId: cardMeta.id,
        props: {
          title: { kind: 'value', value: { type: 'string', value: 'Greetings' } },
          onRender: { kind: 'callback', name: 'onCardRender' },
          children: {
            kind: 'nodes',
            value: {
              items: [
                {
                  itemId: 'child-1',
                  kind: 'instance',
                  instance: {
                    kind: 'instance',
                    instanceId: 'greeter-1',
                    componentId: greeterMeta.id,
                    props: {
                      name: { kind: 'value', value: { type: 'string', value: 'Composed Host' } },
                      times: { kind: 'value', value: { type: 'number', value: 1 } },
                    },
                  },
                },
              ],
            },
          },
        },
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
    // useComponentPreview's `updateProp` calls - targeting the nested Greeter
    // instance by id-based InstancePath: [{propName: "children", itemId: "child-1"}]. ---
    const greeterPath = [{ propName: 'children', itemId: 'child-1' }];
    assert.deepEqual(editor.getInstanceAtPath(initialDoc, greeterPath).instanceId, 'greeter-1');
    const editedDoc = editor.setPropAtPath(initialDoc, greeterPath, 'name', { kind: 'value', value: committedName });
    assert.notDeepEqual(editedDoc, initialDoc, 'setPropAtPath does not mutate the original document');
    assert.deepEqual(editor.getInstanceAtPath(editedDoc, greeterPath).props.name.value, committedName);

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
    // exactly like tests/runtime-v2.test.cjs proves for the bare runtime. ---
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

    // --- A v1 document is refused outright by computePreviewState's underlying validateComposition
    // (this is the compile-break floor this phase-3 change fixes: preview.ts no longer builds/
    // consumes v1-shaped documents at all - a caller handing one in gets the real "unsupported-
    // schema-version" diagnostic, not silently-wrong output). ---
    const v1Doc = { schemaVersion: 1, root: { kind: 'instance', id: cardMeta.id, props: {} } };
    const v1State = editor.computePreviewState(v1Doc, metadata, registry, callbacks);
    assert.equal(v1State.validation.valid, false);
    assert.ok(v1State.validation.diagnostics.some((d) => d.code === 'unsupported-schema-version'));
  } finally {
    cleanFixtureOutput();
  }
});

test('editor slot outlets: palette filtering, insertion, rejection, reordering, removal on SlotCard.actions', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const slotIconMeta = byName(metadata, 'SlotIcon');
    const greeterMeta = byName(metadata, 'Greeter');
    const cardMeta = byName(metadata, 'Card');

    const doc = {
      schemaVersion: 2,
      root: {
        kind: 'instance',
        instanceId: 'root-1',
        componentId: slotCardMeta.id,
        props: {
          header: { kind: 'nodes', value: { items: [{ itemId: 'h1', kind: 'text', value: 'Header' }] } },
          actions: { kind: 'nodes', value: { items: [] } },
          icon: { kind: 'componentRef', value: { source: 'project', id: slotIconMeta.id } },
          caption: { kind: 'richText', value: { kind: 'richText', version: 1, inline: false, nodes: [{ type: 'paragraph', children: [{ type: 'text', text: 'Caption', marks: [] }] }] } },
        },
      },
    };
    assert.equal(runtime.validateComposition(doc, metadata, registry).valid, true);

    // --- Palette filtering: SlotCard.actions is `{kind:"any", maxItems:1}` per-entry
    // (each() path) - Greeter (a real registered project component) must be offered;
    // Card, which is ALSO a real component, is offered too since "any" has no accepts
    // list - both entries appear in the palette, both `ok: true`, computed via the same
    // checkSlotValue/resolveSlotPolicy pair validateComposition itself uses. ---
    const palette = editor.computeInsertablePalette(slotCardMeta, 'actions', [], 0, metadata, registry);
    const greeterEntry = palette.find((p) => p.component.id === greeterMeta.id);
    const cardEntry = palette.find((p) => p.component.id === cardMeta.id);
    assert.ok(greeterEntry?.result.ok, 'Greeter is insertable into an "any"-policy actions slot');
    assert.ok(cardEntry?.result.ok, 'Card is insertable into an "any"-policy actions slot too');

    // --- Insertion: insert a Greeter instance as the first action. newInstanceItem
    // creates a bare instance with no props set - Greeter's "name" prop is required,
    // so set it before inserting (a real palette-driven "drop" would prompt for
    // required props too; this test only needs a document that both insertSlotItem's
    // own acceptance check AND the full validateComposition pass agree is valid). ---
    const greeterItem = editor.newInstanceItem(greeterMeta.id);
    greeterItem.instance.props.name = { kind: 'value', value: { type: 'string', value: 'Action Greeter' } };
    const afterInsert = editor.insertSlotItem(doc, metadata, registry, [], 'actions', 0, greeterItem);
    assert.equal(afterInsert.ok, true, JSON.stringify(afterInsert));
    assert.equal(afterInsert.document.root.props.actions.value.items.length, 1);
    assert.equal(afterInsert.document.root.props.actions.value.items[0].itemId, greeterItem.itemId);
    assert.notEqual(afterInsert.document, doc, 'insertion produces a new document, never mutates the original');
    assert.equal(doc.root.props.actions.value.items.length, 0, 'the original document is untouched');
    assert.equal(runtime.validateComposition(afterInsert.document, metadata, registry).valid, true);

    // --- Rejection: SlotCard.actions has collection maxItems: 3 and each() maxItems: 1
    // per entry (SlotCard's own colocated rule). Inserting a SECOND item at the SAME
    // per-entry index a real UI would call "adding to this same action slot" still
    // succeeds structurally (a new array entry, its own independent per-entry budget) -
    // exercise the real rejection case instead: inserting text where the per-entry
    // policy is "any" (which DOES accept text) is not a rejection; instead prove
    // rejection via the componentRef `icon` slot, which only accepts SlotIcon. ---
    const iconRejection = editor.setComponentRefProp(afterInsert.document, metadata, registry, [], 'icon', { source: 'project', id: greeterMeta.id });
    assert.equal(iconRejection.ok, false, 'Greeter is not in icon\'s accepts list (only SlotIcon)');
    assert.ok(iconRejection.reason.length > 0, 'a rejected drop carries a human-readable reason');
    assert.equal(iconRejection.document, afterInsert.document, 'a rejected operation leaves the document unchanged (same reference)');
    assert.equal(runtime.validateComposition(iconRejection.document, metadata, registry).valid, true, 'the untouched document is still valid');

    // Collection maxItems: fill actions up to 3, a 4th insertion must be rejected and leave items.length at 3.
    let doc3 = afterInsert.document;
    for (let i = 0; i < 2; i++) {
      const step = editor.insertSlotItem(doc3, metadata, registry, [], 'actions', doc3.root.props.actions.value.items.length, editor.newTextItem(`Action ${String(i + 2)}`));
      assert.equal(step.ok, true, JSON.stringify(step));
      doc3 = step.document;
    }
    assert.equal(doc3.root.props.actions.value.items.length, 3);
    const overflow = editor.insertSlotItem(doc3, metadata, registry, [], 'actions', 3, editor.newTextItem('Action 4'));
    assert.equal(overflow.ok, false, 'a 4th action exceeds actions\' collection maxItems: 3');
    assert.match(overflow.reason, /maxItems/);
    assert.equal(overflow.document, doc3, 'the document is unchanged after the rejected 4th insertion');
    assert.equal(doc3.root.props.actions.value.items.length, 3, 'items.length did not change');

    // --- Reordering: move the first action to the last position, preserving every itemId
    // (and the nested instance's own instanceId). ---
    const idsBefore = doc3.root.props.actions.value.items.map((i) => i.itemId);
    const instanceIdBefore = doc3.root.props.actions.value.items[0].instance.instanceId;
    const reordered = editor.moveSlotItem(doc3, [], 'actions', 0, 2);
    const idsAfter = reordered.root.props.actions.value.items.map((i) => i.itemId);
    assert.deepEqual(new Set(idsAfter), new Set(idsBefore), 'reordering preserves the exact set of itemIds');
    assert.notDeepEqual(idsAfter, idsBefore, 'reordering actually changed the order');
    assert.equal(idsAfter[2], idsBefore[0], 'the moved item landed at the target index');
    const movedItem = reordered.root.props.actions.value.items[2];
    assert.equal(movedItem.instance.instanceId, instanceIdBefore, "the moved instance's own instanceId survives the reorder");
    assert.equal(runtime.validateComposition(reordered, metadata, registry).valid, true, 'a reordered document still validates');

    // A path into the moved item's own subtree still resolves correctly after reordering -
    // this is the entire point of id-based addressing over v1's child-index paths.
    const pathToMoved = [{ propName: 'actions', itemId: movedItem.itemId }];
    assert.equal(editor.getInstanceAtPath(reordered, pathToMoved).instanceId, instanceIdBefore);

    // --- Removal ---
    const removed = editor.removeSlotItem(reordered, [], 'actions', movedItem.itemId);
    assert.equal(removed.root.props.actions.value.items.length, 2);
    assert.ok(!removed.root.props.actions.value.items.some((i) => i.itemId === movedItem.itemId));
    assert.equal(runtime.validateComposition(removed, metadata, registry).valid, true);
  } finally {
    cleanFixtureOutput();
  }
});

test('editor slot outlets: insertion capacity counts the FULL resulting slot, not just items before the insertion index (Codex repair finding #2)', () => {
  // A minimal, hand-built (no real CLI run needed - checkSlotValue/insertSlotItem behave
  // identically regardless of where metadata came from, per tests/schema.test.cjs's own
  // convention) non-per-entry ReactNode slot with its own maxItems: 1, reached WITHOUT each() -
  // SlotCard.actions can't reproduce this bug (its per-entry policy always uses
  // currentItemCount: 0, unaffected), so this needs a slot whose OWN maxItems bounds
  // CompositionSlotValue.items directly.
  const hostMeta = {
    id: 'host-1',
    name: 'Host',
    sourcePath: 'virtual/Host.tsx',
    isDefault: false,
    props: { header: { schema: { type: 'reactNode' }, required: false, diagnostics: [] } },
    diagnostics: [],
    slots: [{ path: ['header'], slot: { kind: 'any', maxItems: 1 }, appliedFrom: { slot: 'project' } }],
  };
  const metadata = { schemaVersion: 2, generatedAt: '2026-01-01T00:00:00.000Z', components: [hostMeta], externalLibraries: [] };
  const library = { files: [] };
  const doc = {
    schemaVersion: 2,
    root: {
      kind: 'instance',
      instanceId: 'root',
      componentId: 'host-1',
      props: { header: { kind: 'nodes', value: { items: [{ itemId: 'existing', kind: 'text', value: 'first' }] } } },
    },
  };

  // Before the fix: items.slice(0, 0) = [], currentItemCount: 0, 0+1 > 1 is false -> wrongly
  // accepted, committing a 2-item slot into a maxItems:1 policy.
  const atStart = editor.insertSlotItem(doc, metadata, library, [], 'header', 0, editor.newTextItem('second'));
  assert.equal(atStart.ok, false, 'inserting at index 0 into an already-full maxItems:1 slot must be rejected regardless of insertion position');
  assert.equal(atStart.document, doc, 'a rejected insertion leaves the document unchanged (same reference)');

  // Insertion at the end (the one position the old slice-based count happened to get right) must
  // still be rejected the same way - proves the fix isn't position-dependent either.
  const atEnd = editor.insertSlotItem(doc, metadata, library, [], 'header', 1, editor.newTextItem('second'));
  assert.equal(atEnd.ok, false, 'inserting at the end of an already-full maxItems:1 slot is also rejected');

  // Control: an empty slot still accepts one item.
  const emptyDoc = { ...doc, root: { ...doc.root, props: { header: { kind: 'nodes', value: { items: [] } } } } };
  const intoEmpty = editor.insertSlotItem(emptyDoc, metadata, library, [], 'header', 0, editor.newTextItem('only'));
  assert.equal(intoEmpty.ok, true, 'an empty maxItems:1 slot still accepts its one allowed item');
});

test('editor slot outlets: rich text mark toggling validated through checkSlotValue', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const slotIconMeta = byName(metadata, 'SlotIcon');

    const doc = {
      schemaVersion: 2,
      root: {
        kind: 'instance',
        instanceId: 'root-1',
        componentId: slotCardMeta.id,
        props: {
          header: { kind: 'nodes', value: { items: [] } },
          actions: { kind: 'nodes', value: { items: [] } },
          icon: { kind: 'componentRef', value: { source: 'project', id: slotIconMeta.id } },
          caption: { kind: 'richText', value: editor.plainRichText('Hello', false) },
        },
      },
    };
    assert.equal(runtime.validateComposition(doc, metadata, registry).valid, true);

    // caption's policy accepts only the "bold" mark, not "italic" (SlotCard's own colocated rule).
    const bolded = editor.toggleRichTextMark(doc.root.props.caption.value, 'bold');
    const okResult = editor.checkRichTextValue(slotCardMeta, 'caption', registry, bolded);
    assert.equal(okResult.ok, true);
    const afterBold = editor.setRichTextProp(doc, metadata, registry, [], 'caption', bolded);
    assert.equal(afterBold.ok, true, JSON.stringify(afterBold));
    assert.equal(afterBold.document.root.props.caption.value.nodes[0].children[0].marks.includes('bold'), true);
    assert.equal(runtime.validateComposition(afterBold.document, metadata, registry).valid, true);

    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(runtime.renderComposition(afterBold.document, metadata, registry));
    assert.match(html, /<strong>Hello<\/strong>/, 'the bold mark is reflected in the rendered output');

    // italic is not in caption's accepted marks list - toggling it must be rejected and leave the document unchanged.
    const italicized = editor.toggleRichTextMark(afterBold.document.root.props.caption.value, 'italic');
    const rejection = editor.setRichTextProp(afterBold.document, metadata, registry, [], 'caption', italicized);
    assert.equal(rejection.ok, false, 'italic is not in caption\'s accepted marks list');
    assert.ok(/italic/.test(rejection.reason) || rejection.diagnostics.some((d) => d.code === 'richtext-mark-not-accepted'));
    assert.equal(rejection.document, afterBold.document, 'the rejected mark toggle leaves the document unchanged');
  } finally {
    cleanFixtureOutput();
  }
});

test('editor slot outlets: componentRef picker restricted to the resolved policy\'s accepts list via checkSlotValue', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const slotIconMeta = byName(metadata, 'SlotIcon');
    const greeterMeta = byName(metadata, 'Greeter');

    const picker = editor.computeComponentRefPalette(slotCardMeta, 'icon', metadata, registry);
    const iconEntry = picker.find((p) => p.component.id === slotIconMeta.id);
    const greeterEntry = picker.find((p) => p.component.id === greeterMeta.id);
    assert.ok(iconEntry?.result.ok, 'SlotIcon is accepted by icon\'s componentRef policy');
    assert.equal(greeterEntry?.result.ok, false, 'Greeter is not in icon\'s accepts list');
  } finally {
    cleanFixtureOutput();
  }
});
