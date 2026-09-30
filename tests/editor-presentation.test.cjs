const assert = require('node:assert/strict');
const test = require('node:test');
const {registerCommonSchemas, resolveEditorPresentation} = require('../packages/schema/src/index.ts');
registerCommonSchemas();

const native = {origin: 'native', exposure: 'broad'};
const prop = (extra = {}) => ({schema: {type: 'string'}, required: false, diagnostics: [], ...extra});
const rule = (path, editor, layer = 'project') => ({path, editor,
  appliedFrom: Object.fromEntries(Object.keys(editor).map(key => [key, layer]))});
const component = (props, editorRules = []) => ({id: 'Button', name: 'Button', sourcePath: 'button.tsx',
  isDefault: false, diagnostics: [], props, editorRules});
const resolve = (metadata, ...path) => resolveEditorPresentation(metadata, path);

test('editor presentation rejects the synthetic component root', () => {
  const result = resolveEditorPresentation(component({title: prop()}), []);
  assert.equal(result.visibility, 'primary');
  assert.equal(result.diagnostics[0].code, 'invalid-editor-path');
});

test('native forwarding is advanced while explicit, component, and unknown APIs remain primary', () => {
  const metadata = component({
    title: prop({provenance: native}),
    disabled: prop({provenance: {...native, exposure: 'explicit'}}),
    variant: prop({provenance: {origin: 'component', exposure: 'broad'}}),
    unknown: prop({provenance: {origin: 'unknown', exposure: 'unknown'}}),
    legacy: prop(),
  });
  assert.equal(resolve(metadata, 'title').visibility, 'advanced');
  for (const name of ['disabled', 'variant', 'unknown', 'legacy']) {
    assert.equal(resolve(metadata, name).visibility, 'primary', name);
  }
});

test('required props cannot be hidden or demoted, regardless of native inheritance', () => {
  for (const visibility of ['hidden', 'advanced']) {
    const metadata = component({label: prop({required: true, provenance: native})},
      [rule(['label'], {visibility})]);
    const result = resolve(metadata, 'label');
    assert.equal(result.visibility, 'primary');
    assert.equal(result.source, 'required');
    assert.ok(result.diagnostics.some(d => d.code === 'required-editor-visibility' && d.severity === 'error'));
    assert.equal(metadata.props.label.required, true);
  }
});

test('a source default permits overrides but an example value does not', () => {
  const value = {type: 'string', value: 'Save'};
  for (const visibility of ['hidden', 'advanced']) {
    const metadata = component({
      defaulted: prop({required: true, defaultValue: value}),
      example: prop({required: true, exampleValue: value}),
    }, ['defaulted', 'example'].map(name => rule([name], {visibility})));
    assert.equal(resolve(metadata, 'defaulted').visibility, visibility);
    assert.deepEqual(resolve(metadata, 'defaulted').diagnostics, []);
    assert.equal(resolve(metadata, 'example').visibility, 'primary');
    assert.equal(resolve(metadata, 'example').diagnostics[0].code, 'required-editor-visibility');
  }
});

test('onClick can be promoted without changing its callback contract or presentation labels', () => {
  const callback = {type: 'function', returnType: {type: 'void'},
    paramsType: {type: 'array', tupleTypes: [], indexType: {type: 'never'}}};
  const metadata = component({onClick: prop({schema: callback, provenance: native})},
    [rule(['onClick'], {visibility: 'primary', group: 'events', label: 'On click'})]);
  const before = JSON.stringify(metadata);
  const result = resolve(metadata, 'onClick');
  assert.equal(result.visibility, 'primary');
  assert.equal(result.source, 'project');
  assert.equal(result.group, 'events');
  assert.equal(result.label, 'On click');
  assert.equal(JSON.stringify(metadata), before);
});

test('auto restores inference while preserving separately merged group and label', () => {
  const metadata = component({title: prop({provenance: native})}, [{
    path: ['title'], editor: {visibility: 'auto', group: 'accessibility', label: 'Tooltip'},
    appliedFrom: {visibility: 'project', group: 'library', label: 'library'},
  }]);
  const result = resolve(metadata, 'title');
  assert.equal(result.visibility, 'advanced');
  assert.equal(result.source, 'inferred');
  assert.equal(result.group, 'accessibility');
  assert.equal(result.label, 'Tooltip');
});

test('required nested fields stay reachable through a container annotated hidden', () => {
  const metadata = component({content: prop({schema: {type: 'object', properties: {
    heading: {schema: {type: 'string'}, required: true},
    caption: {schema: {type: 'string'}, required: false},
  }}})}, [rule(['content'], {visibility: 'hidden'}),
    rule(['content', 'heading'], {visibility: 'advanced'})]);
  assert.equal(resolve(metadata, 'content').visibility, 'primary');
  assert.equal(resolve(metadata, 'content').diagnostics[0].code, 'required-editor-visibility');
  assert.equal(resolve(metadata, 'content', 'heading').visibility, 'primary');
  assert.equal(resolve(metadata, 'content', 'heading').diagnostics[0].code, 'required-editor-visibility');
});

test('hidden optional containers hide optional descendants', () => {
  const metadata = component({content: prop({schema: {type: 'object', properties: {
    caption: {schema: {type: 'string'}, required: false},
  }}})}, [rule(['content'], {visibility: 'hidden'})]);
  assert.equal(resolve(metadata, 'content', 'caption').visibility, 'hidden');
  assert.equal(resolve(metadata, 'content', 'caption').source, 'ancestor');
});

test('deep array and variant ancestors keep required fields reachable', () => {
  const each = {kind: 'each'};
  const variant = {kind: 'variant', prop: 'kind', equals: 'card'};
  const branch = kind => ({type: 'object', properties: {
    kind: {schema: {type: 'string', literal: kind}, required: true},
    title: {schema: {type: 'string'}, required: true},
  }});
  const paths = [['content'], ['content', 'items'], ['content', 'items', each],
    ['content', 'items', each, variant], ['content', 'items', each, variant, 'title']];
  const metadata = component({content: prop({schema: {type: 'object', properties: {
    items: {required: false, schema: {type: 'array', tupleTypes: [],
      indexType: {type: 'union', types: [branch('card'), branch('link')]}}},
  }}})}, paths.map(path => rule(path, {visibility: 'hidden'})));
  for (const path of paths) {
    const result = resolveEditorPresentation(metadata, path);
    assert.equal(result.visibility, 'primary', JSON.stringify(path));
    assert.ok(result.diagnostics.some(d => d.code === 'required-editor-visibility'), JSON.stringify(path));
  }
});

test('a source-defaulted object can be hidden with its required descendants', () => {
  const metadata = component({content: prop({required: true,
    defaultValue: {type: 'object', value: {title: {type: 'string', value: 'Default'}}},
    schema: {type: 'object', properties: {title: {schema: {type: 'string'}, required: true}}},
  })}, [rule(['content'], {visibility: 'hidden'}), rule(['content', 'title'], {visibility: 'hidden'})]);
  assert.equal(resolve(metadata, 'content').visibility, 'hidden');
  assert.deepEqual(resolve(metadata, 'content').diagnostics, []);
  assert.equal(resolve(metadata, 'content', 'title').visibility, 'hidden');
  assert.deepEqual(resolve(metadata, 'content', 'title').diagnostics, []);
});

test('a common required union field stays primary without a variant selector', () => {
  const metadata = component({content: prop({schema: {type: 'union', types: ['card', 'link'].map(kind => ({
    type: 'object', properties: {
      kind: {schema: {type: 'string', literal: kind}, required: true},
      title: {schema: {type: 'string'}, required: true},
    },
  }))}})}, [rule(['content', 'title'], {visibility: 'advanced'})]);
  const result = resolve(metadata, 'content', 'title');
  assert.equal(result.visibility, 'primary');
  assert.ok(result.diagnostics.some(d => d.code === 'required-editor-visibility'));
});
