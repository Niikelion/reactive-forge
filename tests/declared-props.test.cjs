const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {validateComposition, renderComposition, exportToTsx} = require('../packages/runtime/src/index.ts');
const {Host} = require('./fixtures/declared-props/Host.tsx');

const string = {type: 'string'};
const number = {type: 'number'};
const node = {type: 'reactNode'};
const array = {type: 'array', tupleTypes: [], indexType: string};
const handler = {type: 'function', returnType: string, paramsType: {type: 'array', tupleTypes: [string, number]}};
const object = properties => ({type: 'object', properties});
const declaration = (schema, required = true) => ({schema, required});
const nullableString = {type: 'union', types: [string, {type: 'null'}]};
const hostProps = {title: declaration(string), count: declaration(number), onActivate: declaration(handler), content: declaration(object({heading: declaration(node), labels: declaration(array)})), children: declaration(node), subtitle: declaration(nullableString, false), date: declaration({type: 'date'}, false)};
const metadata = {schemaVersion: 4, generatedAt: '2026-10-01T00:00:00.000Z', components: [{id: 'host', name: 'Host', sourcePath: 'Host.tsx', isDefault: false, props: Object.fromEntries(Object.entries(hostProps).map(([name, value]) => [name, {...value, diagnostics: []}])), diagnostics: [], slots: []}]};
const library = {files: [{path: 'Host.tsx', components: {Host: {id: 'host', component: Host, args: object(hostProps)}}}]};
const binding = name => ({kind: 'prop', name});
const composed = value => ({kind: 'composed', value});
function document() {
  return {
    schemaVersion: 5,
    props: {
      title: declaration(string),
      count: {...declaration(number, false), defaultValue: {type: 'number', value: 2}},
      activate: {...declaration(handler), typeSource: {componentId: 'host', propName: 'onActivate'}},
      heading: declaration(node),
      labels: declaration(array),
      children: declaration(node),
      unused: declaration(string, false),
    },
    root: {kind: 'instance', instanceId: 'root', componentId: 'host', props: {
      title: binding('title'), count: binding('count'), onActivate: binding('activate'), children: binding('children'),
      content: composed({kind: 'object', fields: {heading: binding('heading'), labels: binding('labels')}}),
    }},
  };
}
const fixtureDir = path.join(__dirname, 'fixtures', 'declared-props');

test('React node defaults preserve plain text and explicit null in runtime and generated JSX', () => {
  for (const defaultValue of [{type: 'string', value: 'Default content'}, {type: 'null'}]) {
    const doc = document();
    doc.props.children = {...declaration(node, false), defaultValue};
    const props = {title: 'Defaults', activate: value => value, heading: null, labels: []};
    const result = compile(exportDocument(doc));
    try {
      assert.deepEqual(result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
      const expected = renderToStaticMarkup(renderComposition(doc, metadata, library, {props}));
      assert.equal(renderToStaticMarkup(React.createElement(require(result.generated).default, props)), expected);
      if (defaultValue.type === 'string') assert.match(expected, /Default content/);
    } finally { result.dispose(); }
  }
});
function compile(source, consumer) {
  const scratch = fs.mkdtempSync(path.join(fixtureDir, 'generated-'));
  const generated = path.join(scratch, 'Generated.tsx');
  fs.writeFileSync(generated, source);
  const files = [generated];
  if (consumer) {
    const consumerPath = path.join(scratch, 'Consumer.tsx');
    fs.writeFileSync(consumerPath, consumer);
    files.push(consumerPath);
  }
  const program = ts.createProgram(files, {strict: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, skipLibCheck: true});
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return {generated, scratch, diagnostics, dispose: () => fs.rmSync(scratch, {recursive: true, force: true})};
}
function exportDocument(doc) {
  return exportToTsx(doc, metadata, library, {resolveImportPath: () => '../Host'});
}

test('declared public props render dynamic primitives, functions, nested values and children with TSX parity', () => {
  const doc = document();
  const props = {title: 'Hello', activate: (label, count) => `${label}:${count}`, heading: React.createElement('strong', null, 'Heading'), labels: ['A', 'B'], children: React.createElement('em', null, 'Child')};
  const source = exportDocument(doc);
  assert.doesNotMatch(source, /callbacks/);
  assert.match(source, /unused/);
  const result = compile(source);
  try {
    assert.deepEqual(result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    const Generated = require(result.generated).default;
    const actual = renderToStaticMarkup(renderComposition(doc, metadata, library, {props}));
    assert.equal(actual, '<article><h1>Hello</h1><p>Hello:2</p><header><strong>Heading</strong></header><aside>A,B</aside><em>Child</em></article>');
    assert.equal(renderToStaticMarkup(React.createElement(Generated, props)), actual);
    assert.equal(renderToStaticMarkup(renderComposition(doc, metadata, library, {props: {...props, count: 8}})), actual.replace('Hello:2', 'Hello:8'));
  } finally { result.dispose(); }
});

test('public prop validation rejects missing required inputs, undeclared bindings and incompatible declarations', () => {
  const doc = document();
  assert.ok(validateComposition(doc, metadata, library, undefined, {}).diagnostics.some(d => d.severity === 'error'));
  assert.throws(() => renderComposition(doc, metadata, library, {props: {}}));
  assert.throws(() => renderComposition(doc, metadata, library, {props: {
    title: 'Wrong count', count: 'two', activate: value => value, heading: null, labels: [], children: null,
  }}));
  const undeclared = document();
  undeclared.root.props.title = binding('unknown');
  assert.ok(validateComposition(undeclared, metadata, library).diagnostics.some(d => d.severity === 'error'));
  assert.throws(() => exportDocument(undeclared));
  const incompatible = document();
  incompatible.props.title.schema = number;
  assert.ok(validateComposition(incompatible, metadata, library).diagnostics.some(d => d.severity === 'error'));
  assert.throws(() => exportDocument(incompatible));
  const invalidDefault = document();
  invalidDefault.props.count.defaultValue = {type: 'string', value: 'wrong'};
  assert.ok(validateComposition(invalidDefault, metadata, library).diagnostics.some(d => d.severity === 'error'));
});

test('exact function typeSource rejects callers with the wrong handler signature', () => {
  const result = compile(exportDocument(document()), `import Generated from './Generated';\nexport const example = <Generated title="x" activate={(value: number) => value} heading={null} labels={[]} children={null} />;`);
  try {
    const errors = result.diagnostics.filter(d => d.file?.fileName.endsWith('Consumer.tsx'));
    assert.ok(errors.some(d => ts.flattenDiagnosticMessageText(d.messageText, '\n').includes('not assignable')), 'wrong callback parameters and return type must fail TypeScript');
    assert.equal(result.diagnostics.filter(d => d.file?.fileName.endsWith('Generated.tsx')).length, 0);
  } finally { result.dispose(); }
});

test('bindings resolve inside individual array entries without inventing public inputs', () => {
  const doc = document();
  doc.props.label = declaration(string);
  doc.root.props.content.value.fields.labels = {kind: 'array', items: [
    {itemId: 'dynamic-label', value: binding('label')},
    {itemId: 'static-label', value: {kind: 'leaf', value: {type: 'string', value: 'fixed'}}},
  ]};
  const props = {title: 'Array', activate: value => value, heading: null, labels: [], label: 'dynamic', children: null};
  const result = compile(exportDocument(doc));
  try {
    assert.deepEqual(result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    const expected = renderToStaticMarkup(renderComposition(doc, metadata, library, {props}));
    assert.match(expected, /dynamic,fixed/);
    assert.equal(renderToStaticMarkup(React.createElement(require(result.generated).default, props)), expected);
  } finally { result.dispose(); }
});

test('public input names retain their declared spelling even when they are not identifiers', () => {
  const doc = document();
  doc.props['page-title'] = doc.props.title;
  delete doc.props.title;
  doc.root.props.title = binding('page-title');
  const props = {'page-title': 'Quoted', activate: value => value, heading: null, labels: [], children: null};
  const result = compile(exportDocument(doc));
  try {
    assert.deepEqual(result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    assert.equal(renderToStaticMarkup(React.createElement(require(result.generated).default, props)), renderToStaticMarkup(renderComposition(doc, metadata, library, {props})));
  } finally { result.dispose(); }
});

test('exact typeSource preserves explicitly declared null in an optional source prop', () => {
  const doc = document();
  doc.props.subtitle = {...declaration(nullableString), typeSource: {componentId: 'host', propName: 'subtitle'}};
  doc.root.props.subtitle = binding('subtitle');
  const result = compile(exportDocument(doc), `import Generated from './Generated';\nexport const example = <Generated title="x" activate={(label, count) => label + count} heading={null} labels={[]} children={null} subtitle={null} />;`);
  const props = {title: 'Nullable', activate: value => value, heading: null, labels: [], children: null, subtitle: null};
  try {
    assert.deepEqual(result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    const actual = renderToStaticMarkup(renderComposition(doc, metadata, library, {props}));
    assert.match(actual, /<small><\/small>/);
    assert.equal(renderToStaticMarkup(React.createElement(require(result.generated).default, props)), actual);
  } finally { result.dispose(); }
});

test('legacy callback registries stay a runtime compatibility path and never become invented export props', () => {
  const doc = document();
  doc.schemaVersion = 4;
  delete doc.props;
  doc.root.props = {
    title: composed({kind: 'leaf', value: {type: 'string', value: 'Legacy'}}),
    count: composed({kind: 'leaf', value: {type: 'number', value: 1}}),
    onActivate: {kind: 'callback', name: 'activate'},
    content: composed({kind: 'object', fields: {heading: {kind: 'nodes', value: {items: []}}, labels: {kind: 'leaf', value: {type: 'array', value: []}}}}),
    children: composed({kind: 'nodes', value: {items: []}}),
  };
  assert.match(renderToStaticMarkup(renderComposition(doc, metadata, library, {callbacks: {activate: label => label}})), /Legacy/);
  assert.throws(() => exportDocument(doc), /callback|declared|prop/i);
});

test('editor function controls bind only explicitly declared function inputs', () => {
  const {FunctionControl} = require('../packages/editor/src/controls/FunctionControl.ts');
  const changes = [];
  const control = FunctionControl({schema: handler, currentValue: binding('activate'), declaredProps: document().props, callbacks: {hidden: () => {}}, onChange: value => changes.push(value)});
  const markup = renderToStaticMarkup(control);
  assert.match(markup, /activate/);
  assert.doesNotMatch(markup, /hidden|value="title"/);
  control.props.onChange({target: {value: 'activate'}});
  assert.deepEqual(changes, [binding('activate')]);
});

test('editor previews receive declared runtime values and report missing required inputs', () => {
  const {computePreviewState} = require('../packages/editor/src/preview.ts');
  const props = {title: 'Preview', activate: value => value, heading: null, labels: [], children: null};
  const good = computePreviewState(document(), metadata, library, {}, props);
  assert.equal(good.validation.valid, true, JSON.stringify(good.validation.diagnostics));
  assert.match(renderToStaticMarkup(good.element), /Preview/);
  const missing = computePreviewState(document(), metadata, library);
  assert.equal(missing.validation.valid, false);
  assert.equal(missing.element, null);
});

test('malformed declarations return diagnostics and optional inputs cannot bind required targets without defaults', () => {
  for (const declaration of [null, {schema: string, required: 'yes'}, {schema: {type: 'missing'}, required: true}]) {
    const doc = document();
    doc.props.title = declaration;
    const result = validateComposition(doc, metadata, library);
    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some(d => d.code === 'invalid-prop-declaration'));
  }
  const doc = document();
  delete doc.props.count.defaultValue;
  const result = validateComposition(doc, metadata, library);
  assert.ok(result.diagnostics.some(d => d.code === 'optional-prop-bound-to-required'));
  assert.throws(() => exportDocument(doc));
});

test('ordinary function declarations compile from their schemas without imported typeSource', () => {
  const doc = document();
  delete doc.props.activate.typeSource;
  const result = compile(exportDocument(doc), `import Generated from './Generated';\nexport const example = <Generated title="x" activate={(label, count) => label + count} heading={null} labels={[]} children={null} />;`);
  try {
    assert.deepEqual(result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    const props = {title: 'Schema', activate: (label, count) => `${label}:${count}`, heading: null, labels: [], children: null};
    assert.equal(renderToStaticMarkup(React.createElement(require(result.generated).default, props)), renderToStaticMarkup(renderComposition(doc, metadata, library, {props})));
  } finally { result.dispose(); }
});

test('bound ReactNode values obey component groups and specific component restrictions', () => {
  function Allowed() {return React.createElement('b', null, 'Allowed');}
  function Other() {return React.createElement('i', null, 'Other');}
  const group = {kind: 'group', id: 'test/allowed'};
  const extra = [Allowed, Other].map((component, index) => ({id: index === 0 ? 'allowed' : 'other', name: component.name, sourcePath: 'Host.tsx', isDefault: false, props: {}, diagnostics: [], slots: [], groups: index === 0 ? [group] : []}));
  const registry = {files: [...library.files, {path: 'Other.tsx', components: Object.fromEntries(extra.map((entry, index) => [entry.name, {id: entry.id, component: index === 0 ? Allowed : Other, args: object({}), groups: entry.groups}]))}]};
  for (const acceptance of [group, {source: 'project', id: 'allowed'}]) {
    const host = {...metadata.components[0], slots: [{path: ['children'], slot: {kind: 'components', accepts: [acceptance], multiple: true, minItems: 1, maxItems: 2}, appliedFrom: {slot: 'project'}}]};
    const meta = {...metadata, components: [host, ...extra]};
    const props = {title: 'Slots', activate: value => value, heading: null, labels: [], children: React.createElement(Allowed)};
    assert.equal(validateComposition(document(), meta, registry, undefined, props).valid, true);
    for (const children of [React.createElement(Other), React.createElement('button'), 'raw text', []]) {
      const result = validateComposition(document(), meta, registry, undefined, {...props, children});
      assert.equal(result.valid, false, `invalid children should fail: ${String(children)}`);
      assert.throws(() => renderComposition(document(), meta, registry, {props: {...props, children}}));
    }
    const children = React.createElement(React.Fragment, null, React.createElement(Allowed), [React.createElement(Allowed), React.createElement(Allowed)]);
    assert.equal(validateComposition(document(), meta, registry, undefined, {...props, children}).valid, false, 'nested fragments and arrays count towards cardinality');
  }
});

test('bound nested object arrays obey collection cardinality at the exact metadata path', () => {
  const doc = document();
  doc.props.content = declaration(hostProps.content.schema);
  doc.root.props.content = binding('content');
  const meta = {...metadata, components: [{...metadata.components[0], slots: [{path: ['content', 'labels'], collection: {minItems: 1, maxItems: 2}, appliedFrom: {collection: 'project'}}]}]};
  const props = {title: 'Collections', activate: value => value, heading: null, labels: [], children: null, content: {heading: null, labels: ['valid']}};
  assert.equal(validateComposition(doc, meta, library, undefined, props).valid, true);
  for (const labels of [[], ['A', 'B', 'C']]) {
    const result = validateComposition(doc, meta, library, undefined, {...props, content: {heading: null, labels}});
    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some(d => /^collection-(min|max)-items/.test(d.code)));
  }
});

test('Date input defaults deserialize to native instances with exported TSX parity', () => {
  const doc = document();
  const iso = '2026-10-01T12:34:56.000Z';
  doc.props.date = {...declaration({type: 'date'}, false), defaultValue: {type: 'date', value: iso}};
  doc.root.props.date = binding('date');
  const result = compile(exportDocument(doc));
  const props = {title: 'Date', activate: value => value, heading: null, labels: [], children: null};
  try {
    assert.deepEqual(result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    const actual = renderToStaticMarkup(renderComposition(doc, metadata, library, {props}));
    assert.match(actual, /<time>2026-10-01T12:34:56.000Z<\/time>/);
    assert.equal(renderToStaticMarkup(React.createElement(require(result.generated).default, props)), actual);
    const override = {...props, date: new Date('2026-10-02T00:00:00.000Z')};
    assert.equal(renderToStaticMarkup(React.createElement(require(result.generated).default, override)), renderToStaticMarkup(renderComposition(doc, metadata, library, {props: override})));
  } finally { result.dispose(); }
});

test('whole object bindings preserve nested discriminated union slot constraints', () => {
  const group = {kind: 'group', id: 'test/allowed'};
  const branch = kind => object({kind: declaration({type: 'string', literal: kind}), body: declaration(node)});
  const contentSchema = object({heading: declaration(node), labels: declaration(array), block: declaration({type: 'union', types: [branch('restricted'), branch('open')]})});
  const doc = document();
  doc.props.content = declaration(contentSchema);
  doc.root.props.content = binding('content');
  const host = {...metadata.components[0], groups: [group], props: {...metadata.components[0].props, content: {...declaration(contentSchema), diagnostics: []}}, slots: [{path: ['content', 'block', {kind: 'variant', prop: 'kind', equals: 'restricted'}, 'body'], slot: {kind: 'components', accepts: [group]}, appliedFrom: {slot: 'project'}}]};
  const meta = {...metadata, components: [host]};
  const registry = {files: [{...library.files[0], components: {Host: {...library.files[0].components.Host, groups: [group]}}}]};
  const props = {title: 'Variant', activate: value => value, heading: null, labels: [], children: null, content: {heading: null, labels: [], block: {kind: 'restricted', body: React.createElement(Host)}}};
  assert.equal(validateComposition(doc, meta, registry, undefined, props).valid, true);
  const disallowed = {...props, content: {...props.content, block: {kind: 'restricted', body: React.createElement('button')}}};
  const rejected = validateComposition(doc, meta, registry, undefined, disallowed);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.diagnostics.some(d => d.code === 'component-not-accepted'));
  const open = {...props, content: {...props.content, block: {kind: 'open', body: React.createElement('button')}}};
  assert.equal(validateComposition(doc, meta, registry, undefined, open).valid, true, 'restriction applies only to selected restricted variant');
});

test('React reserved key and prototype-sensitive public declarations are refused', () => {
  for (const name of ['key', '__proto__']) {
    const doc = document();
    Object.defineProperty(doc.props, name, {value: declaration(string, false), enumerable: true});
    const result = validateComposition(doc, metadata, library);
    assert.equal(result.valid, false, `reserved declaration ${name} should fail`);
    assert.ok(result.diagnostics.some(d => d.code === 'invalid-prop-declaration'));
    assert.throws(() => exportDocument(doc));
  }
});
