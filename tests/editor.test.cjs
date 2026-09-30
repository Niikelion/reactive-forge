// Gate D, part 2 (docs/claude-handoff.md section D) + phase 3 slot outlets
// (docs/claude-slots-handoff.md), extended by the recursive-composition-value
// repair (docs/slot-contract-recursive.md): "add the preview hook and
// replaceable schema-driven controls", proving the full acceptance bar for
// the whole gate: "a small example edits props, nests components,
// saves/reloads a composition, and renders equivalent output. Runtime works
// independently of the editor." Phase 3 extends this with real slot-outlet
// operations (insertion/rejection/reordering/richText/componentRef), all
// going through the SAME `checkSlotValue`/`resolveSlotPolicy` pair
// `packages/runtime`'s own validation uses (docs/slot-contract.md section 8)
// - see packages/editor/src/slots.ts.
//
// Documents in this file are v3-shaped (`schemaVersion: 3`,
// `CompositionPropValue` collapsed to `{kind:"callback"}` /
// `{kind:"composed", value: CompositionValue}`, and `CompositionValue`'s six
// recursive kinds - leaf/object/array/variant/nodes/richText/componentRef).
// `ValuePath` (packages/editor/src/preview.ts) is the generalized addressing
// scheme replacing the old one-level `InstancePath`; `instancePath(...)`
// below builds the common one-level case
// `[{kind:"prop",propName},{kind:"slotItem",itemId},{kind:"instance"}]` this
// file's older, non-nested tests use, while the new nested-path tests near
// the end of this file build multi-step `ValuePath`s directly.
//
// Reuses the exact real-bundle-plus-metadata pipeline tests/runtime.test.cjs
// already proves (`forge codegen` then `forge bundle` against
// tests/fixtures/bundle-project/, via its own forge.editor.config.ts/
// out-editor to avoid racing other test files' output directories - now with
// `annotationSources.colocated: true` so SlotCard's/NestedSlotCard's real
// slot rules come through), then drives @reactive-forge/editor
// (packages/editor/src) on top of the real generated bundle.js + metadata.json.
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

// ---------------------------------------------------------------------------------------------
// v3 CompositionValue/CompositionPropValue wrapping helpers (docs/slot-contract-recursive.md
// section 1) - every hand-built document in this file goes through these instead of constructing
// the wrapped shape inline at every call site.
// ---------------------------------------------------------------------------------------------
// Bare CompositionValue builders (no "composed" wrapper) - used wherever a CompositionValue
// nests INSIDE another one (an "object"'s fields, an "array"/CompositionArrayItem's own value) -
// only a whole PROP VALUE is ever wrapped in {kind:"composed", ...} (docs/slot-contract-recursive.md
// section 1.2: "a prop's top-level value is just CompositionValue at SlotPath=[propName]").
function leafValue(value) { return { kind: 'leaf', value }; }
function objectV(fields) { return { kind: 'object', fields }; }
function arrayV(items) { return { kind: 'array', items }; }
function nodesV(items) { return { kind: 'nodes', value: { items } }; }
function richContent(metadata, text, inline = false) {
  return nodesV([{ itemId: 'rich-content', kind: 'instance', instance: {
    kind: 'instance', instanceId: 'rich-instance', componentId: byName(metadata, 'RichContent').id,
    props: { text: leaf({ type: 'string', value: text }), inline: leaf({ type: 'boolean', value: inline }) },
  } }]);
}
function componentRefV(value) { return { kind: 'componentRef', value }; }

// Top-level CompositionPropValue builders - what actually goes into instance.props[propName].
function composed(value) { return { kind: 'composed', value }; }
function leaf(value) { return composed(leafValue(value)); }
function objectValue(fields) { return composed(objectV(fields)); }
function arrayValue(items) { return composed(arrayV(items)); }
function nodesValue(items) { return composed(nodesV(items)); }
function componentRefProp(value) { return composed(componentRefV(value)); }
function callbackProp(name) { return { kind: 'callback', name }; }

// One-level ValuePath: the degenerate case docs/slot-contract-recursive.md section 3.1 calls out
// - "descend into the nodes slot at propName, then into the instance item whose itemId is
// itemId" - built as a real 3-step ValuePath rather than the old flat {propName, itemId} shape.
// Only valid for a BARE ReactNode-domain prop (top-level CompositionValue kind "nodes", e.g.
// Card.children) - a declared ARRAY prop with an each() per-entry policy (e.g. SlotCard.actions)
// resolves one level deeper still; use `arrayEntryInstancePath` for those.
function instancePath(propName, itemId) {
  return [{ kind: 'prop', propName }, { kind: 'slotItem', itemId }, { kind: 'instance' }];
}

// For a declared-array per-entry slot (e.g. `actions: ReactNode[]`, docs/slot-contract-recursive.md
// section 8.3): array entries and their rendered nodes have independent stable IDs.
// Older fixture documents happen to reuse the same ID at both levels; newly inserted
// entries pass their distinct entry ID explicitly.
function arrayEntryInstancePath(propName, itemId, entryId = itemId) {
  return [{ kind: 'prop', propName }, { kind: 'arrayItem', itemId: entryId }, { kind: 'slotItem', itemId }, { kind: 'instance' }];
}

// Flatten only for assertions about rendered nodes. Operations keep the actual array entries.
function arrayEntries(prop) {
  return prop.value.items.flatMap((entry) => (entry.value.kind === 'nodes' ? entry.value.value.items : []));
}

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

    // --- Build a nested v3 composition: Card wrapping Greeter as a "children" nodes-slot
    // item, a callback-reference prop - exactly like tests/runtime.test.cjs's document. ---
    const initialDoc = {
      schemaVersion: 3,
      root: {
        kind: 'instance',
        instanceId: 'card-1',
        componentId: cardMeta.id,
        props: {
          title: leaf({ type: 'string', value: 'Greetings' }),
          onRender: callbackProp('onCardRender'),
          children: nodesValue([
            {
              itemId: 'child-1',
              kind: 'instance',
              instance: {
                kind: 'instance',
                instanceId: 'greeter-1',
                componentId: greeterMeta.id,
                props: {
                  name: leaf({ type: 'string', value: 'Composed Host' }),
                  times: leaf({ type: 'number', value: 1 }),
                },
              },
            },
          ]),
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
    // instance by the generalized ValuePath (docs/slot-contract-recursive.md
    // section 3.1): [prop "children", slotItem "child-1", instance]. ---
    const greeterPath = instancePath('children', 'child-1');
    assert.deepEqual(editor.getInstanceAtPath(initialDoc, greeterPath).instanceId, 'greeter-1');
    const editedDoc = editor.setPropAtPath(initialDoc, greeterPath, 'name', leaf(committedName));
    assert.notDeepEqual(editedDoc, initialDoc, 'setPropAtPath does not mutate the original document');
    assert.deepEqual(editor.getInstanceAtPath(editedDoc, greeterPath).props.name.value.value, committedName);

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
    // The control shows the document's REAL current value (v3: props.title is
    // {kind:"composed", value:{kind:"leaf", value}} - resolveInitialValueJson must unwrap that,
    // not just the old flat {kind:"value"} shape, for this to be "Greetings", not empty).
    assert.match(harnessHtml, /value="Greetings"/, "the string control shows the document's real current title value");
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

    // --- A v1 document is refused outright by computePreviewState's underlying validateComposition
    // (this is the compile-break floor this phase-3 change fixes: preview.ts no longer builds/
    // consumes v1-shaped documents at all - a caller handing one in gets the real "unsupported-
    // schema-version" diagnostic, not silently-wrong output). ---
    const v1Doc = { schemaVersion: 1, root: { kind: 'instance', id: cardMeta.id, props: {} } };
    const v1State = editor.computePreviewState(v1Doc, metadata, registry, callbacks);
    assert.equal(v1State.validation.valid, false);
    assert.ok(v1State.validation.diagnostics.some((d) => d.code === 'unsupported-schema-version'));

    // A v2 document is refused the same way - v3 APIs require an explicit migration call first
    // (migrateCompositionDocumentV2ToV3), never silent reinterpretation.
    const v2Doc = { schemaVersion: 2, root: { kind: 'instance', instanceId: 'card-1', componentId: cardMeta.id, props: {} } };
    const v2State = editor.computePreviewState(v2Doc, metadata, registry, callbacks);
    assert.equal(v2State.validation.valid, false);
    assert.ok(v2State.validation.diagnostics.some((d) => d.code === 'unsupported-schema-version' && d.message.includes('migrateCompositionDocumentV2ToV3')));
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
      schemaVersion: 3,
      root: {
        kind: 'instance',
        instanceId: 'root-1',
        componentId: slotCardMeta.id,
        props: {
          header: nodesValue([{ itemId: 'h1', kind: 'text', value: 'Header' }]),
          // actions: ReactNode[] is a genuine DECLARED ARRAY with an each() per-entry policy
          // (docs/slot-contract-recursive.md section 8.3) - its top-level CompositionValue is
          // "array", not a flat "nodes" list (that flat shape is only correct for a bare
          // ReactNode prop like "header" above, which has no array schema underneath it).
          actions: arrayValue([]),
          icon: componentRefProp({ source: 'project', id: slotIconMeta.id }),
          caption: composed(richContent(metadata, 'Caption')),
        },
      },
    };
    assert.equal(runtime.validateComposition(doc, metadata, registry).valid, true, JSON.stringify(runtime.validateComposition(doc, metadata, registry).diagnostics));

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
    greeterItem.instance.props.name = leaf({ type: 'string', value: 'Action Greeter' });
    const afterInsert = editor.insertSlotItem(doc, metadata, registry, [], 'actions', 0, greeterItem);
    assert.equal(afterInsert.ok, true, JSON.stringify(afterInsert));
    assert.equal(arrayEntries(afterInsert.document.root.props.actions).length, 1);
    assert.equal(arrayEntries(afterInsert.document.root.props.actions)[0].itemId, greeterItem.itemId);
    assert.notEqual(afterInsert.document, doc, 'insertion produces a new document, never mutates the original');
    assert.equal(arrayEntries(doc.root.props.actions).length, 0, 'the original document is untouched');
    assert.equal(runtime.validateComposition(afterInsert.document, metadata, registry).valid, true, JSON.stringify(runtime.validateComposition(afterInsert.document, metadata, registry).diagnostics));

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
      const step = editor.insertSlotItem(doc3, metadata, registry, [], 'actions', arrayEntries(doc3.root.props.actions).length, editor.newTextItem(`Action ${String(i + 2)}`));
      assert.equal(step.ok, true, JSON.stringify(step));
      doc3 = step.document;
    }
    assert.equal(arrayEntries(doc3.root.props.actions).length, 3);
    const overflow = editor.insertSlotItem(doc3, metadata, registry, [], 'actions', 3, editor.newTextItem('Action 4'));
    assert.equal(overflow.ok, false, 'a 4th action exceeds actions\' collection maxItems: 3');
    assert.match(overflow.reason, /maxItems/);
    assert.equal(overflow.document, doc3, 'the document is unchanged after the rejected 4th insertion');
    assert.equal(arrayEntries(doc3.root.props.actions).length, 3, 'items.length did not change');

    // --- Reordering: move the first action to the last position, preserving every itemId
    // (and the nested instance's own instanceId). ---
    const idsBefore = arrayEntries(doc3.root.props.actions).map((i) => i.itemId);
    const instanceIdBefore = arrayEntries(doc3.root.props.actions)[0].instance.instanceId;
    const reorderResult = editor.moveSlotItem(doc3, metadata, registry, [], 'actions', 0, 2);
    assert.equal(reorderResult.ok, true, JSON.stringify(reorderResult));
    const reordered = reorderResult.document;
    const idsAfter = arrayEntries(reordered.root.props.actions).map((i) => i.itemId);
    assert.deepEqual(new Set(idsAfter), new Set(idsBefore), 'reordering preserves the exact set of itemIds');
    assert.notDeepEqual(idsAfter, idsBefore, 'reordering actually changed the order');
    assert.equal(idsAfter[2], idsBefore[0], 'the moved item landed at the target index');
    const movedItem = arrayEntries(reordered.root.props.actions)[2];
    assert.equal(movedItem.instance.instanceId, instanceIdBefore, "the moved instance's own instanceId survives the reorder");
    assert.equal(runtime.validateComposition(reordered, metadata, registry).valid, true, 'a reordered document still validates');

    // A path into the moved item's own subtree still resolves correctly after reordering -
    // this is the entire point of id-based addressing over v1's child-index paths, now through
    // a declared-array per-entry slot (prop -> arrayItem -> slotItem -> instance).
    const movedEntryId = reordered.root.props.actions.value.items[2].itemId;
    const pathToMoved = arrayEntryInstancePath('actions', movedItem.itemId, movedEntryId);
    assert.equal(editor.getInstanceAtPath(reordered, pathToMoved).instanceId, instanceIdBefore);

    // --- Removal ---
    const removeResult = editor.removeSlotItem(reordered, metadata, registry, [], 'actions', movedEntryId);
    assert.equal(removeResult.ok, true, JSON.stringify(removeResult));
    const removed = removeResult.document;
    assert.equal(arrayEntries(removed.root.props.actions).length, 2);
    assert.ok(!arrayEntries(removed.root.props.actions).some((i) => i.itemId === movedItem.itemId));
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
  const library = { files: [{ path: 'virtual/Host.tsx', components: {
    Host: { id: 'host-1', component: ({ header }) => header, args: { type: 'object', properties: {} } },
  } }] };
  const doc = {
    schemaVersion: 3,
    root: {
      kind: 'instance',
      instanceId: 'root',
      componentId: 'host-1',
      props: { header: nodesValue([{ itemId: 'existing', kind: 'text', value: 'first' }]) },
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
  const emptyDoc = { ...doc, root: { ...doc.root, props: { header: nodesValue([]) } } };
  const intoEmpty = editor.insertSlotItem(emptyDoc, metadata, library, [], 'header', 0, editor.newTextItem('only'));
  assert.equal(intoEmpty.ok, true, 'an empty maxItems:1 slot still accepts its one allowed item');
});

test('editor slot outlets: host rich text components edit as ordinary nodes and reject nonmembers', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const doc = { schemaVersion: 3, root: { kind: 'instance', instanceId: 'root', componentId: slotCardMeta.id,
      props: { header: nodesValue([]), actions: arrayValue([]),
        icon: componentRefProp({ source: 'project', id: byName(metadata, 'SlotIcon').id }),
        caption: composed(richContent(metadata, 'Hello')) } } };
    assert.equal(runtime.validateComposition(doc, metadata, registry).valid, true);
    const updatedRoot = editor.updateValueAtPath(doc.root, [{ kind: 'prop', propName: 'caption' }], () => richContent(metadata, 'Edited'));
    const updated = { ...doc, root: updatedRoot };
    assert.equal(runtime.validateComposition(updated, metadata, registry).valid, true);
    const { renderToStaticMarkup } = require('react-dom/server');
    assert.match(renderToStaticMarkup(runtime.renderComposition(updated, metadata, registry)), /Edited/);
    const palette = editor.computeInsertablePalette(slotCardMeta, 'caption', [], 0, metadata, registry);
    assert.equal(palette.find(item => item.component.id === byName(metadata, 'RichContent').id).result.ok, true);
    assert.equal(palette.find(item => item.component.id === byName(metadata, 'Greeter').id).result.ok, false);
    const invalid = editor.updateValueAtPath(doc.root, [{ kind: 'prop', propName: 'caption' }], () => nodesV([
      { itemId: 'wrong', kind: 'instance', instance: { kind: 'instance', instanceId: 'wrong-instance', componentId: byName(metadata, 'TextContent').id, props: { text: leaf({ type: 'string', value: 'Plain' }) } } }
    ]));
    assert.equal(runtime.validateComposition({ ...doc, root: invalid }, metadata, registry).valid, false);
  } finally { cleanFixtureOutput(); }
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

// ---------------------------------------------------------------------------------------------
// Real acceptance proof - nested-path editing (docs/claude-slots-repair.md finding #1's whole
// point: nested paths like content.header.title were never actually enforced or editable before
// this repair). Drives real NestedSlotCard instances through the real forge codegen/bundle
// pipeline (buildFixture() above), addressing/editing at depth via the new generalized
// `ValuePath` (packages/editor/src/preview.ts), never a hand-rolled parallel mechanism.
// ---------------------------------------------------------------------------------------------

function buildNestedDoc(nestedMeta, metadata) {
  return {
    schemaVersion: 3,
    root: {
      kind: 'instance',
      instanceId: 'nested-root',
      componentId: nestedMeta.id,
      props: {
        content: objectValue({
          header: objectV({
            title: richContent(metadata, 'Hello', true),
            subtitle: leafValue({ type: 'string', value: 'Subtitle' }),
          }),
        }),
        sections: arrayValue([
          {
            itemId: 'sec-1',
            value: objectV({
              heading: leafValue({ type: 'string', value: 'Intro' }),
              body: nodesV([{ itemId: 'body-1a', kind: 'text', value: 'Body one' }]),
            }),
          },
          {
            itemId: 'sec-2',
            value: objectV({
              heading: leafValue({ type: 'string', value: 'Details' }),
              body: nodesV([{ itemId: 'body-2a', kind: 'text', value: 'Body two' }]),
            }),
          },
        ]),
        actions: arrayValue([
          {
            itemId: 'action-1',
            value: nodesV([{ itemId: 'act-1a', kind: 'text', value: 'Save' }]),
          },
        ]),
      },
    },
  };
}

test('editor nested addressing: grouped components nested two object levels deep are editable via ValuePath', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const doc = buildNestedDoc(nestedMeta, metadata);
    assert.equal(runtime.validateComposition(doc, metadata, registry).valid, true, JSON.stringify(runtime.validateComposition(doc, metadata, registry).diagnostics));

    // Build the ValuePath docs/slot-contract-recursive.md section 8.1's worked example describes:
    // prop "content" -> field "header" -> field "title". getValueAtPath resolves it exactly like
    // validateCompositionValue's own recursive traversal does.
    const titlePath = [{ kind: 'prop', propName: 'content' }, { kind: 'field', name: 'header' }, { kind: 'field', name: 'title' }];
    const titleValue = editor.getValueAtPath(doc.root, titlePath);
    assert.equal(titleValue.kind, 'nodes');
    assert.equal(titleValue.value.items[0].instance.props.text.value.value.value, 'Hello');

    // Commit a real change through updateValueAtPath - the same building block setPropAtPath/the
    // slot operations use, now exercised at depth 3 instead of depth 1.
    const editedInstance = editor.updateValueAtPath(doc.root, titlePath, () => richContent(metadata, 'Edited', true));
    const editedDoc = { ...doc, root: editedInstance };

    assert.notDeepEqual(editedDoc, doc, 'the edit produced a new document');
    // Structural sharing: sections/actions (untouched by this edit) are the SAME reference.
    assert.equal(editedDoc.root.props.sections, doc.root.props.sections, 'only the spine down to content.header.title was copied - sections is untouched, same reference');
    assert.equal(editedDoc.root.props.actions, doc.root.props.actions, 'actions is untouched, same reference');
    assert.notEqual(editedDoc.root.props.content, doc.root.props.content, 'content itself is a new object (the edit is on its spine)');

    const revalidated = runtime.validateComposition(editedDoc, metadata, registry);
    assert.equal(revalidated.valid, true, JSON.stringify(revalidated.diagnostics));

    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(runtime.renderComposition(editedDoc, metadata, registry));
    assert.match(html, /Edited/, 'host component content edited at depth is rendered');

    // A disallowed mark (only "bold" is accepted per NestedSlotCardMetadata's rule) must fail
    // validation when addressed the same way - proves policy enforcement really reaches this depth.
    const invalidInstance = editor.updateValueAtPath(doc.root, titlePath, () => nodesV([{ itemId: 'plain', kind: 'text', value: 'Not registered' }]));
    const invalidDoc = { ...doc, root: invalidInstance };
    const invalidResult = runtime.validateComposition(invalidDoc, metadata, registry);
    assert.equal(invalidResult.valid, false, 'plain text does not satisfy the registered RichText group');
  } finally {
    cleanFixtureOutput();
  }
});

test('editor nested addressing: sections.each().body (array of objects, each with its own independent slot) - insert/remove inside ONE section without disturbing others', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const doc = buildNestedDoc(nestedMeta, metadata);
    assert.equal(runtime.validateComposition(doc, metadata, registry).valid, true);

    // Path to sec-1's own body "nodes" value: prop "sections" -> arrayItem "sec-1" -> field "body".
    const sec1BodyPath = [{ kind: 'prop', propName: 'sections' }, { kind: 'arrayItem', itemId: 'sec-1' }, { kind: 'field', name: 'body' }];
    const sec1Body = editor.getValueAtPath(doc.root, sec1BodyPath);
    assert.equal(sec1Body.kind, 'nodes');
    assert.equal(sec1Body.value.items.length, 1);

    // Insert a second node into sec-1's body only.
    const newItem = editor.newTextItem('Body one, second node');
    const editedInstance = editor.updateValueAtPath(doc.root, sec1BodyPath, (current) => {
      assert.equal(current.kind, 'nodes');
      return { kind: 'nodes', value: { items: [...current.value.items, newItem] } };
    });
    const editedDoc = { ...doc, root: editedInstance };

    const editedSec1Body = editor.getValueAtPath(editedDoc.root, sec1BodyPath);
    assert.equal(editedSec1Body.value.items.length, 2, 'sec-1\'s body now holds 2 items (within its own maxItems:3 per-entry budget)');

    // sec-2's body is completely untouched - same items, same reference at the array level for
    // the unrelated entry (only sec-1's own spine was copied).
    const sections = editedDoc.root.props.sections.value.items;
    const sec1Entry = sections.find((s) => s.itemId === 'sec-1');
    const sec2Entry = sections.find((s) => s.itemId === 'sec-2');
    const originalSec2Entry = doc.root.props.sections.value.items.find((s) => s.itemId === 'sec-2');
    assert.equal(sec2Entry, originalSec2Entry, 'sec-2\'s own entry is untouched (same reference) - editing sec-1\'s body never disturbed it');
    assert.equal(sec2Entry.value.fields.body.value.items.length, 1, 'sec-2 still holds exactly its own original 1 body item');
    assert.equal(sections.length, 2, 'the sections array itself still holds exactly 2 entries - inserting into an entry\'s body never adds/removes a section');

    const revalidated = runtime.validateComposition(editedDoc, metadata, registry);
    assert.equal(revalidated.valid, true, JSON.stringify(revalidated.diagnostics));

    // Remove the item just inserted - back to sec-1 holding 1 body item, sections structure intact.
    const removedInstance = editor.updateValueAtPath(editedDoc.root, sec1BodyPath, (current) => (
      { kind: 'nodes', value: { items: current.value.items.filter((i) => i.itemId !== newItem.itemId) } }
    ));
    const removedDoc = { ...editedDoc, root: removedInstance };
    assert.equal(editor.getValueAtPath(removedDoc.root, sec1BodyPath).value.items.length, 1);
    assert.equal(runtime.validateComposition(removedDoc, metadata, registry).valid, true);

    // Reorder-safety at this depth (docs/slot-contract-recursive.md section 3.2): move sec-1 to
    // the end of `sections`, then confirm a ValuePath into ITS OWN body still resolves correctly -
    // the whole point of id-based (never position-based) addressing generalized to arbitrary depth.
    const sectionsValue = editedDoc.root.props.sections.value;
    const reorderedItems = [sectionsValue.items[1], sectionsValue.items[0]];
    const reorderedInstance = {
      ...editedDoc.root,
      props: { ...editedDoc.root.props, sections: arrayValue(reorderedItems) },
    };
    const reorderedDoc = { ...editedDoc, root: reorderedInstance };
    assert.equal(runtime.validateComposition(reorderedDoc, metadata, registry).valid, true, 'a reordered sections array still validates');
    const bodyAfterReorder = editor.getValueAtPath(reorderedDoc.root, sec1BodyPath);
    assert.equal(bodyAfterReorder.value.items.length, 2, 'the ValuePath into sec-1\'s own body still resolves correctly after sections was reordered');
  } finally {
    cleanFixtureOutput();
  }
});

test('editor nested addressing: an "actions" array entry whose own value renders multiple nodes - the flat-array-gap closure, from the editor side', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const doc = buildNestedDoc(nestedMeta, metadata);
    assert.equal(runtime.validateComposition(doc, metadata, registry).valid, true);

    // action-1 currently holds exactly one rendered node ("Save"). Insert a second node into
    // THIS SAME array entry - the case v2's flat item model could never represent at all
    // (docs/slot-contract-recursive.md section 8.3): one declared array entry, multiple
    // independently-addressable rendered nodes inside it.
    const action1BodyPath = [{ kind: 'prop', propName: 'actions' }, { kind: 'arrayItem', itemId: 'action-1' }];
    const action1Value = editor.getValueAtPath(doc.root, action1BodyPath);
    assert.equal(action1Value.kind, 'nodes');
    assert.equal(action1Value.value.items.length, 1);

    const secondNode = editor.newTextItem('Cancel');
    const editedInstance = editor.updateValueAtPath(doc.root, action1BodyPath, (current) => (
      { kind: 'nodes', value: { items: [...current.value.items, secondNode] } }
    ));
    const editedDoc = { ...doc, root: editedInstance };

    const editedAction1 = editor.getValueAtPath(editedDoc.root, action1BodyPath);
    assert.equal(editedAction1.value.items.length, 2, 'action-1 now renders 2 independently-addressable nodes (within its own each() maxItems:2 budget)');
    assert.equal(editedAction1.value.items[0].itemId, 'act-1a');
    assert.equal(editedAction1.value.items[1].itemId, secondNode.itemId);

    // The "actions" array itself still holds exactly 1 declared entry (bounded independently by
    // ["actions"]'s own collection.maxItems:3) - adding a node to one entry's own body never adds
    // a new array entry, proving the two cardinalities (declared entries vs. rendered nodes per
    // entry) are independently enforced, exactly per the worked example.
    assert.equal(editedDoc.root.props.actions.value.items.length, 1);

    const revalidated = runtime.validateComposition(editedDoc, metadata, registry);
    assert.equal(revalidated.valid, true, JSON.stringify(revalidated.diagnostics));

    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(runtime.renderComposition(editedDoc, metadata, registry));
    assert.match(html, /Save/);
    assert.match(html, /Cancel/);

    // Both nodes inside the one entry are independently removable without touching the other or
    // the entry itself.
    const withoutFirst = editor.updateValueAtPath(editedDoc.root, action1BodyPath, (current) => (
      { kind: 'nodes', value: { items: current.value.items.filter((i) => i.itemId !== 'act-1a') } }
    ));
    const withoutFirstDoc = { ...editedDoc, root: withoutFirst };
    const remaining = editor.getValueAtPath(withoutFirstDoc.root, action1BodyPath);
    assert.equal(remaining.value.items.length, 1);
    assert.equal(remaining.value.items[0].itemId, secondNode.itemId, 'the second node ("Cancel") survives independently of the first');
    assert.equal(withoutFirstDoc.root.props.actions.value.items.length, 1, 'the declared "actions" array entry itself is untouched by removing one of its own rendered nodes');
    assert.equal(runtime.validateComposition(withoutFirstDoc, metadata, registry).valid, true);

    // Exceeding the per-entry maxItems:2 budget (a 3rd node into the SAME entry) must be
    // rejected by validation - proves this nested "nodes" position enforces its own independent
    // cardinality budget, not the outer array's.
    const overflowInstance = editor.updateValueAtPath(editedDoc.root, action1BodyPath, (current) => (
      { kind: 'nodes', value: { items: [...current.value.items, editor.newTextItem('Third')] } }
    ));
    const overflowDoc = { ...editedDoc, root: overflowInstance };
    const overflowResult = runtime.validateComposition(overflowDoc, metadata, registry);
    assert.equal(overflowResult.valid, false, 'a 3rd rendered node in one action entry exceeds its own each() maxItems:2 budget');
  } finally {
    cleanFixtureOutput();
  }
});
