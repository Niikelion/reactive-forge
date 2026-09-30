const assert = require('node:assert/strict');
const test = require('node:test');
const editor = require('../packages/editor/src/index.ts');
const runtime = require('../packages/runtime/src/index.ts');

const reactNode = {type: 'reactNode'};
const actionsSchema = {type: 'array', tupleTypes: [], indexType: reactNode};
const metadata = {schemaVersion: 1, components: [{
  id: 'host', name: 'Host', sourcePath: 'host.tsx', isDefault: false,
  props: {content: {required: true, schema: {type: 'object', properties: {
    actions: {required: true, schema: actionsSchema},
  }}}},
  slots: [
    {path: ['content', 'actions'], collection: {minItems: 1, maxItems: 3}},
    {path: ['content', 'actions', {kind: 'each'}], slot: {kind: 'any', multiple: true, minItems: 1, maxItems: 2}},
  ],
}]};
const library = {files: [{path: 'host.tsx', components: {Host: {
  id: 'host', component: () => null, args: {type: 'object', properties: {}},
}}}]};
const text = (itemId) => ({itemId, kind: 'text', value: itemId});
const nodes = (...ids) => ({kind: 'nodes', value: {items: ids.map(text)}});
const entry = (itemId, ...ids) => ({itemId, value: nodes(...ids)});
const arrayPath = [{kind: 'prop', propName: 'content'}, {kind: 'field', name: 'actions'}];
const nodePath = [...arrayPath, {kind: 'arrayItem', itemId: 'a'}];
function document() {
  return {schemaVersion: 3, root: {kind: 'instance', instanceId: 'root', componentId: 'host', props: {
    content: {kind: 'composed', value: {kind: 'object', fields: {
      actions: {kind: 'array', items: [entry('a', 'one', 'two'), entry('b', 'three')]},
    }}},
  }}};
}
const valueAt = (doc, path) => editor.getValueAtPath(doc.root, path);

test('nested edits reject capacity and missing paths without replacing the document', () => {
  const doc = document();
  assert.equal(runtime.validateComposition(doc, metadata, library).valid, true);
  const result = editor.insertAtValuePath(doc, metadata, library, nodePath, 0, text('extra'));
  assert.equal(result.ok, false);
  assert.equal(result.document, doc);
  assert.equal(valueAt(doc, nodePath).value.items.length, 2);
  const stale = editor.removeAtValuePath(doc, metadata, library,
    [...arrayPath, {kind: 'arrayItem', itemId: 'missing'}], 'one');
  assert.equal(stale.ok, false);
  assert.equal(stale.document, doc);
});

test('array reorder preserves entries, multiple nodes, and stable nested paths', () => {
  const doc = document();
  const original = valueAt(doc, arrayPath).items;
  const moved = editor.moveAtValuePath(doc, metadata, library, arrayPath, 0, 1);
  assert.equal(moved.ok, true);
  const reordered = valueAt(moved.document, arrayPath).items;
  assert.equal(reordered[0], original[1]);
  assert.equal(reordered[1], original[0]);
  assert.deepEqual(valueAt(moved.document, nodePath).value.items.map(i => i.itemId), ['one', 'two']);
  const removed = editor.removeAtValuePath(moved.document, metadata, library, nodePath, 'one');
  assert.equal(removed.ok, true);
  assert.deepEqual(valueAt(removed.document, nodePath).value.items.map(i => i.itemId), ['two']);
  assert.equal(valueAt(removed.document, arrayPath).items[0], original[1]);
});

test('node minimum and collection minimum independently prevent removal', () => {
  const doc = document();
  const bodyPath = [...arrayPath, {kind: 'arrayItem', itemId: 'b'}];
  const denied = editor.removeAtValuePath(doc, metadata, library, bodyPath, 'three');
  assert.equal(denied.ok, false);
  assert.equal(denied.document, doc);
  const first = editor.removeAtValuePath(doc, metadata, library, arrayPath, 'a');
  assert.equal(first.ok, true);
  const second = editor.removeAtValuePath(first.document, metadata, library, arrayPath, 'b');
  assert.equal(second.ok, false);
  assert.equal(second.document, first.document);
});

test('entry insertion preserves separate IDs and enforces ancestor capacity', () => {
  const doc = document();
  const added = editor.insertArrayEntryAtPath(doc, metadata, library, arrayPath, 1, entry('c', 'four', 'five'));
  assert.equal(added.ok, true);
  assert.deepEqual(valueAt(added.document, arrayPath).items.map(i => i.itemId), ['a', 'c', 'b']);
  const denied = editor.insertArrayEntryAtPath(added.document, metadata, library, arrayPath, 0, entry('d', 'six'));
  assert.equal(denied.ok, false);
  assert.equal(denied.document, added.document);
  const duplicate = editor.insertArrayEntryAtPath(doc, metadata, library, arrayPath, 0, entry('a', 'six'));
  assert.equal(duplicate.ok, false);
});

test('generic nested edits reject forbidden slot shapes and unknown components', () => {
  const doc = document();
  const result = editor.editValue(doc, metadata, library, nodePath, () => ({kind: 'leaf', value: {type: 'string', value: 'bypass'}}));
  assert.equal(result.ok, false);
  assert.equal(result.document, doc);
  const replacement = editor.editValue(doc, metadata, library, nodePath, () => ({kind: 'nodes', value: {items: [editor.newInstanceItem('unknown')]}}));
  assert.equal(replacement.ok, false);
  assert.equal(replacement.document, doc);
});
