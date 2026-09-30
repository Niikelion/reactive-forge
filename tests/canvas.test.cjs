const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {CompositionEditor} = require('../packages/editor/src/index.ts');
const {renderComposition} = require('../packages/runtime/src/index.ts');
const {RichText} = require('../packages/schema/src/index.ts');

const nodeSchema = {type: 'reactNode'};
const object = properties => ({type: 'object', properties});
const property = schema => ({schema, required: true});
const nodes = items => ({kind: 'nodes', value: {items}});
const text = (itemId, value) => ({kind: 'text', itemId, value});
const composed = value => ({kind: 'composed', value});
const nestedProps = {
  content: property(object({header: property(object({title: property(nodeSchema)}))})),
  actions: property({type: 'array', tupleTypes: [], indexType: nodeSchema}),
};
const emptyProps = {children: {schema: nodeSchema, required: false}};
const referenceProps = {options: property(object({icon: property({type: 'componentType', props: object({})})}))};
const Nested = ({content, actions}) => React.createElement('article', null,
  React.createElement('header', {'data-location': 'title'}, content.header.title),
  React.createElement('section', {'data-location': 'actions'}, actions));
const Empty = ({children}) => React.createElement('main', {'data-location': 'empty'}, children);
const Icon = () => React.createElement('i', {'data-icon': 'real'}, 'icon');
const Reference = ({options}) => React.createElement('aside', null, React.createElement(options.icon));
const component = (id, props, slots) => ({id, name: id, sourcePath: `${id}.tsx`, isDefault: false, props, ...(slots ? {slots} : {})});
const metadata = {schemaVersion: 1, components: [
  component('Nested', nestedProps), component('Empty', emptyProps), component('Icon', {}),
  component('Reference', referenceProps, [{path: ['options', 'icon'], slot: {kind: 'componentRef', accepts: [{source: 'project', id: 'Icon'}]}}]),
]};
const library = {files: [{path: 'fixture.tsx', components: Object.fromEntries([
  ['Nested', Nested, nestedProps], ['Empty', Empty, emptyProps], ['Icon', Icon, {}], ['Reference', Reference, referenceProps],
].map(([id, component, props]) => [id, {id, component, args: object(props)}]))}]};
const document = (componentId, props) => ({schemaVersion: 3, root: {kind: 'instance', instanceId: 'root', componentId, props}});
const nested = () => document('Nested', {
  content: composed({kind: 'object', fields: {header: {kind: 'object', fields: {title: nodes([text('title', 'Nested title')])}}}}),
  actions: composed({kind: 'array', items: [
    {itemId: 'entry-a', value: nodes([text('a-1', 'First action'), text('a-2', 'Second action')])},
    {itemId: 'entry-b', value: nodes([])},
  ]}),
});
const renderEditor = (doc, extra = {}) => renderToStaticMarkup(React.createElement(CompositionEditor, {
  document: doc, metadata, library, onChange: () => assert.fail('SSR must not commit edits'), ...extra,
}));

test('host component editor replaces a grouped implementation and validates ordinary prop changes', () => {
  const richProps = {text: property({type: 'string'})};
  const RichContent = ({text}) => React.createElement('strong', null, text);
  const hostMetadata = {schemaVersion: 4, components: [
    component('Empty', emptyProps, [{path: ['children'], slot: {kind: 'components', accepts: [RichText], multiple: true}}]),
    component('RichContent', richProps),
  ]};
  const hostLibrary = {files: [{path: 'host.tsx', components: {
    Empty: {id: 'Empty', component: Empty, args: object(emptyProps)},
    RichContent: {id: 'RichContent', component: RichContent, args: object(richProps), groups: [RichText]},
  }}]};
  const stringProp = value => composed({kind: 'leaf', value: {type: 'string', value}});
  const doc = document('Empty', {children: composed(nodes([{itemId: 'rich-item', kind: 'instance', instance: {
    kind: 'instance', instanceId: 'rich-instance', componentId: 'RichContent', props: {text: stringProp('Hello')},
  }}]))});
  const changes = [];
  let hostContext;
  const html = renderEditor(doc, {metadata: hostMetadata, library: hostLibrary, onChange: value => changes.push(value), renderComponent: context => {
    if (context.instance.componentId !== 'RichContent') return context.element;
    hostContext = context;
    return React.createElement('textarea', {'data-host-editor': 'rich', defaultValue: context.instance.props.text.value.value.value});
  }});
  assert.match(html, /<textarea data-host-editor="rich">Hello<\/textarea>/);
  assert.doesNotMatch(html, /<strong>/, 'host editing UI replaces the normal registered component output');
  assert.deepEqual(hostContext.path, [{kind: 'prop', propName: 'children'}, {kind: 'slotItem', itemId: 'rich-item'}, {kind: 'instance'}]);
  hostContext.onChange({text: stringProp('Edited')});
  assert.equal(changes.length, 1);
  assert.equal(changes[0].root.props.children.value.value.items[0].instance.componentId, 'RichContent');
  assert.match(renderToStaticMarkup(renderComposition(changes[0], hostMetadata, hostLibrary)), /<strong>Edited<\/strong>/);
  hostContext.onChange({text: composed({kind: 'leaf', value: {type: 'number', value: 42}})});
  assert.equal(changes.length, 1, 'invalid host edits do not commit');
  assert.equal(doc.root.props.children.value.value.items[0].instance.props.text.value.value.value, 'Hello', 'the original composition is untouched');
});

test('canvas places nested outlets where components render actual prop values', () => {
  const html = renderEditor(nested());
  const title = html.match(/<header[^>]*>([\s\S]*?)<\/header>/)[1];
  const actions = html.match(/<section[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.match(title, /data-slot-path=/);
  assert.match(title, /Nested title/);
  assert.equal((title.match(/data-drop-index=/g) || []).length, 2);
  assert.equal((actions.match(/data-slot-path=/g) || []).length, 2);
  assert.equal((actions.match(/data-drop-index=/g) || []).length, 4);
  assert.match(actions, /First action/);
  assert.match(actions, /Second action/);
  assert.match(html, /data-array-item="entry-a"/);
  assert.match(html, /data-array-item="entry-b"/);
});

test('slot adapters receive stable nested paths and can replace outlet markup', () => {
  const seen = [];
  const html = renderEditor(nested(), {renderSlot: context => {
    seen.push(context);
    return React.createElement('mark', {key: JSON.stringify(context.path), 'data-adapter': seen.length}, context.children);
  }});
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].path, [{kind: 'prop', propName: 'content'}, {kind: 'field', name: 'header'}, {kind: 'field', name: 'title'}]);
  assert.deepEqual(seen[2].path, [{kind: 'prop', propName: 'actions'}, {kind: 'arrayItem', itemId: 'entry-b'}]);
  assert.ok(seen.every(context => React.isValidElement(context.outlet)));
  assert.match(html, /<header[^>]*><mark data-adapter="1">Nested title<\/mark><\/header>/);
  assert.doesNotMatch(html, /data-slot-path|data-drop-index/);
});

test('normal runtime renders no editor wrappers or controls', () => {
  const html = renderToStaticMarkup(renderComposition(nested(), metadata, library));
  assert.equal(html, '<article><header data-location="title">Nested title</header><section data-location="actions">First actionSecond action</section></article>');
});

test('an omitted optional ReactNode receives an empty default drop point', () => {
  const doc = document('Empty', {});
  const html = renderEditor(doc);
  assert.match(html, /<main[^>]*><span[^>]*data-slot-path=/);
  assert.equal((html.match(/data-drop-index=/g) || []).length, 1);
  assert.deepEqual(doc.root.props, {}, 'rendering the editor must not mutate saved props');
  assert.equal(renderToStaticMarkup(renderComposition(doc, metadata, library)), '<main data-location="empty"></main>');
});

test('an omitted optional slot still passes through the host adapter', () => {
  const seen = [];
  const html = renderEditor(document('Empty', {}), {renderSlot: context => {
    seen.push(context.path);
    return React.createElement('mark', {'data-empty-adapter': true}, context.outlet);
  }});
  assert.deepEqual(seen, [[{kind: 'prop', propName: 'children'}]]);
  assert.match(html, /data-empty-adapter="true"/);
});

test('viewing an omitted slot preserves the component default described by metadata', () => {
  const withDefault = {...metadata, components: metadata.components.map(component => component.id !== 'Empty' ? component : {
    ...component, props: {children: {...component.props.children, defaultValue: {type: 'string', value: 'Default content'}}},
  })};
  const DefaultEmpty = ({children = 'Default content'}) => React.createElement('main', {'data-location': 'empty'}, children);
  const withDefaultLibrary = {files: library.files.map(file => ({...file, components: {
    ...file.components, Empty: {...file.components.Empty, component: DefaultEmpty},
  }}))};
  const doc = document('Empty', {});
  const html = renderEditor(doc, {metadata: withDefault, library: withDefaultLibrary});
  const runtimeHtml = renderToStaticMarkup(renderComposition(doc, withDefault, withDefaultLibrary));
  assert.equal(html, runtimeHtml);
  assert.match(html, /Default content/);
  assert.deepEqual(doc.root.props, {});
});

test('nested component references remain constructors with a policy-aware picker', () => {
  const doc = document('Reference', {options: composed({kind: 'object', fields: {
    icon: {kind: 'componentRef', value: {source: 'project', id: 'Icon'}},
  }})});
  const html = renderEditor(doc);
  assert.match(html, /<aside><i data-icon="real">icon<\/i><\/aside>/);
  assert.match(html, /aria-label="Component reference"/);
  assert.match(html, /<option[^>]*disabled=""[^>]*>Nested<\/option>/);
  assert.match(html, /<option[^>]*selected=""[^>]*>Icon<\/option>/);
  assert.doesNotMatch(html, /data-slot-path/);
});
