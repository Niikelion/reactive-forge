const test = require('node:test');
const assert = require('node:assert/strict');
const {createElement} = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {Text, RichText, defineComponentGroup} = require('../packages/schema/src/index.ts');
const {registerComponent, defineGroupValueFactory, createGroupValue, renderComposition, exportToTsx, validateComposition} = require('../packages/runtime/src/index.ts');

function setup() {
  const args = {type: 'object', properties: {text: {required: true, schema: {type: 'string'}}}};
  const HostText = ({text}) => createElement('em', null, text);
  const metadata = {schemaVersion: 4, components: [{id: 'host/Text', name: 'HostText', sourcePath: 'host.tsx', isDefault: false,
    props: {text: {required: true, schema: {type: 'string'}}}, diagnostics: []}]};
  let id = 0;
  const factory = defineGroupValueFactory(Text, input => ({kind: 'instance', instanceId: `host-${++id}`, componentId: 'host/Text',
    props: {text: {kind: 'composed', value: {kind: 'leaf', value: {type: typeof input === 'string' ? 'string' : 'number', value: input}}}}}));
  const library = {files: [{path: 'host.tsx', components: {HostText: registerComponent(HostText, {id: 'host/Text', args, groups: [Text]})}}], groupValueFactories: [factory]};
  return {metadata, library};
}

test('host group factories create validated concrete components with host-owned output', () => {
  const {metadata, library} = setup();
  const first = createGroupValue(defineComponentGroup('forge/Text'), 'Hello', library, metadata);
  const second = createGroupValue(Text, 'World', library, metadata);
  assert.notEqual(first.instanceId, second.instanceId);
  const doc = JSON.parse(JSON.stringify({schemaVersion: 4, root: first}));
  assert.equal(renderToStaticMarkup(renderComposition(doc, metadata, library)), '<em>Hello</em>');
  assert.match(exportToTsx(doc, metadata, library), /<HostText text="Hello"/);
  library.groupValueFactories = [];
  assert.equal(validateComposition(doc, metadata, library).valid, true, 'saved concrete values no longer depend on factories');
});

test('factory resolution rejects missing/ambiguous defaults, wrong membership and invalid props', () => {
  const {metadata, library} = setup();
  assert.throws(() => createGroupValue(RichText, 'x', library, metadata), /exactly one/);
  library.groupValueFactories.push(library.groupValueFactories[0]);
  assert.throws(() => createGroupValue(Text, 'x', library, metadata), /found 2/);
  library.groupValueFactories.pop();
  library.files[0].components.HostText.groups = [];
  assert.throws(() => createGroupValue(Text, 'x', library, metadata), /not registered/);
  library.files[0].components.HostText.groups = [Text];
  assert.throws(() => createGroupValue(Text, 17, library, metadata), /Invalid composition/);
});

test('active legacy richText values are diagnosed rather than rendered or exported', () => {
  const {metadata, library} = setup();
  const doc = {schemaVersion: 4, root: {kind: 'instance', instanceId: 'legacy', componentId: 'host/Text', props: {
    text: {kind: 'composed', value: {kind: 'richText', value: {kind: 'richText', version: 1, inline: true, nodes: []}}}
  }}};
  const result = validateComposition(doc, metadata, library);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(d => d.code === 'legacy-rich-text-requires-host-conversion'));
  assert.throws(() => renderComposition(doc, metadata, library));
  assert.throws(() => exportToTsx(doc, metadata, library));
});

test('unknown group constraints are errors even when the slot is empty or omitted', () => {
  const {metadata, library} = setup();
  metadata.components[0].props.children = {required: false, schema: {type: 'reactNode'}};
  metadata.components[0].slots = [{path: ['children'], slot: {kind: 'components', accepts: [RichText]}, appliedFrom: {slot: 'library'}}];
  const root = createGroupValue(Text, 'Hello', library, {...metadata, components: [{...metadata.components[0], slots: []}]});
  for (const value of [undefined, {kind: 'nodes', value: {items: []}}, {kind: 'nodes', value: {items: [{kind: 'void', itemId: 'empty'}]}}]) {
    root.props.children = value === undefined ? undefined : {kind: 'composed', value};
    if (value === undefined) delete root.props.children;
    const result = validateComposition({schemaVersion: 4, root}, metadata, library);
    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some(d => d.code === 'group-not-registered'));
  }
});
