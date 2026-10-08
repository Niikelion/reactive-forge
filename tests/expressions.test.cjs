const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {validateComposition, renderComposition, exportToTsx} = require('../packages/runtime/src/index.ts');
const {evaluateExpression} = require('../packages/runtime/src/expressions.ts');
const {Box} = require('./fixtures/expressions/Box.tsx');
const {cx} = require('./fixtures/expressions/cx.ts');

const string = {type: 'string'};
const number = {type: 'number'};
const boolean = {type: 'boolean'};
const optional = schema => ({type: 'union', types: [schema, {type: 'undefined'}]});
const literals = values => ({type: 'union', types: values.map(value => ({type: 'string', literal: value}))});
const style = {type: 'object', properties: {padding: {schema: optional(number), required: false}, gap: {schema: optional(number), required: false}, background: {schema: optional(string), required: false}}};
const boxProps = {label: {schema: string, required: true}, className: {schema: optional(string), required: false}, style: {schema: optional(style), required: false}};
const metadata = {schemaVersion: 4, generatedAt: '2026-10-08T00:00:00.000Z', components: [{id: 'box', name: 'Box', sourcePath: 'Box.tsx', isDefault: false, props: Object.fromEntries(Object.entries(boxProps).map(([name, value]) => [name, {...value, diagnostics: []}])), diagnostics: [], slots: []}]};
// The host registers the functions expressions may call; Reactive Forge only knows their types.
const functions = {cx: {implementation: cx, module: '../cx', exportName: 'cx', params: [], rest: optional(string), returns: string}};
const library = {functions, files: [{path: 'Box.tsx', components: {Box: {id: 'box', component: Box, args: {type: 'object', properties: boxProps}}}}]};

const literal = value => ({kind: 'literal', value: typeof value === 'string' ? {type: 'string', value} : typeof value === 'number' ? {type: 'number', value} : {type: 'boolean', value}});
const prop = name => ({kind: 'prop', name});
const local = name => ({kind: 'local', name});
const binary = (op, left, right) => ({kind: 'binary', op, left, right});
const expression = value => ({kind: 'expression', expression: value});
const composed = value => ({kind: 'composed', value});

function document() {
  return {
    schemaVersion: 6,
    props: {
      size: {schema: literals(['small', 'medium', 'large']), required: false, defaultValue: {type: 'string', value: 'small'}},
      tone: {schema: literals(['quiet', 'calm', 'loud', 'alarm']), required: false, defaultValue: {type: 'string', value: 'calm'}},
      disabled: {schema: boolean, required: false, defaultValue: {type: 'boolean', value: false}},
      label: {schema: string, required: true},
      className: {schema: string, required: false},
    },
    locals: {
      // Declared before the local it uses: order comes from dependencies, not position.
      gap: {expression: binary('*', local('padding'), literal(2))},
      padding: {expression: {kind: 'match', input: prop('size'), cases: {small: literal(4), medium: literal(8), large: literal(24)}}},
    },
    root: {kind: 'instance', instanceId: 'root', componentId: 'box', props: {
      label: composed(expression(binary('+', prop('label'), literal('!')))),
      className: composed(expression({kind: 'call', function: 'cx', args: [
        literal('box'),
        {kind: 'if', condition: binary('==', prop('size'), literal('large')), then: literal('box-large'), else: {kind: 'literal', value: {type: 'undefined'}}},
        prop('className'),
      ]})),
      style: composed({kind: 'object', fields: {
        padding: expression(local('padding')),
        gap: expression(local('gap')),
        background: expression({kind: 'if', condition: prop('disabled'), then: literal('#ccc'), else: {kind: 'match', input: prop('tone'), cases: {quiet: literal('#eee'), calm: literal('#9cf'), loud: literal('#f90'), alarm: literal('#f00')}}}),
      }}),
    }},
  };
}

const fixtureDir = path.join(__dirname, 'fixtures', 'expressions');
function compile(source) {
  const scratch = fs.mkdtempSync(path.join(fixtureDir, 'generated-'));
  const generated = path.join(scratch, 'Generated.tsx');
  fs.writeFileSync(generated, source);
  const program = ts.createProgram([generated], {strict: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, skipLibCheck: true});
  return {generated, diagnostics: ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), dispose: () => fs.rmSync(scratch, {recursive: true, force: true})};
}
const exportDocument = doc => exportToTsx(doc, metadata, library, {resolveImportPath: () => '../Box', exportedComponentName: 'Badge'});
const errors = doc => validateComposition(doc, metadata, library).diagnostics.filter(d => d.severity === 'error').map(d => d.code);

test('expressions render and export to plain TypeScript with the same result', () => {
  const doc = document();
  assert.deepEqual(errors(doc), []);
  const source = exportDocument(doc);
  assert.match(source, /import \{ cx \} from "\.\.\/cx"/);
  assert.match(source, /const padding = /);
  assert.ok(source.indexOf('const padding') < source.indexOf('const gap'), 'a local comes after the locals it uses');
  assert.match(source, /cx\("box", /);
  assert.match(source, /\["tone"\]\]/, 'a match of four cases becomes an object lookup');
  assert.match(source, /=== "medium" \? 8 : 24/, 'a match of three cases becomes conditionals');
  const result = compile(source);
  try {
    assert.deepEqual(result.diagnostics, []);
    const Generated = require(result.generated).default;
    for (const props of [
      {label: 'Hi'},
      {label: 'Big', size: 'large', tone: 'alarm', className: 'extra'},
      {label: 'Off', size: 'medium', disabled: true},
    ]) {
      const rendered = renderToStaticMarkup(renderComposition(doc, metadata, library, {props}));
      assert.equal(renderToStaticMarkup(React.createElement(Generated, props)), rendered);
    }
    assert.equal(renderToStaticMarkup(renderComposition(doc, metadata, library, {props: {label: 'Big', size: 'large', tone: 'alarm', className: 'extra'}})),
      '<div class="box box-large extra" style="padding:24px;gap:48px;background:#f00">Big!</div>');
  } finally { result.dispose(); }
});

test('expressions are typed against the position they fill', () => {
  const undeclared = document();
  undeclared.root.props.label = composed(expression(prop('missing')));
  assert.ok(errors(undeclared).includes('undeclared-composition-prop'));

  const incompatible = document();
  incompatible.root.props.style.value.fields.padding = expression(literal('wide'));
  assert.ok(errors(incompatible).includes('incompatible-expression'));

  const arithmetic = document();
  arithmetic.locals.gap.expression = binary('*', prop('label'), literal(2));
  assert.ok(errors(arithmetic).includes('invalid-expression'));

  const partial = document();
  delete partial.locals.padding.expression.cases.large;
  assert.ok(errors(partial).includes('non-exhaustive-match'));
  partial.locals.padding.expression.fallback = literal(12);
  assert.deepEqual(errors(partial), []);

  const cycle = document();
  cycle.locals.padding.expression = local('gap');
  assert.ok(errors(cycle).includes('local-cycle'));

  const unknownFunction = document();
  unknownFunction.root.props.className.value.expression.function = 'missing';
  assert.ok(errors(unknownFunction).includes('unknown-function'));

  const wrongArgument = document();
  wrongArgument.root.props.className.value.expression.args.push(literal(3));
  assert.ok(errors(wrongArgument).includes('incompatible-expression'));

  const unsafe = document();
  unsafe.root.props.label = composed(expression({kind: 'get', object: {kind: 'object', fields: {}}, key: '__proto__'}));
  assert.ok(errors(unsafe).includes('invalid-expression'));
});

test('expressions need schemaVersion 6', () => {
  const older = {...document(), schemaVersion: 5};
  delete older.locals;
  assert.ok(errors(older).includes('unsupported-schema-version'));
  assert.throws(() => exportDocument(older));
});

test('evaluation follows the documented semantics', () => {
  const scope = {props: {flag: undefined, count: 3, record: {a: 1}}, locals: {}};
  assert.equal(evaluateExpression(binary('&&', prop('flag'), literal(true)), scope), false);
  assert.equal(evaluateExpression({kind: 'unary', op: '!', value: prop('flag')}, scope), true);
  assert.equal(evaluateExpression({kind: 'get', object: prop('record'), key: 'b'}, scope), undefined);
  assert.equal(evaluateExpression({kind: 'match', input: prop('count'), cases: {'3': literal('three')}}, scope), 'three');
  assert.equal(evaluateExpression({kind: 'call', function: 'cx', args: [literal('a'), prop('flag'), literal('c')]}, {...scope, functions}), 'a c');
});

test('emitted operators keep their grouping', () => {
  const doc = document();
  doc.locals.gap.expression = binary('*', binary('+', local('padding'), literal(1)), {kind: 'unary', op: '-', value: literal(-2)});
  const source = exportDocument(doc);
  assert.match(source, /const gap = \(padding \+ 1\) \* -\(-2\)/);
  const result = compile(source);
  try {
    assert.deepEqual(result.diagnostics, []);
    const Generated = require(result.generated).default;
    assert.match(renderToStaticMarkup(React.createElement(Generated, {label: 'x'})), /gap:10px/);
    assert.match(renderToStaticMarkup(renderComposition(doc, metadata, library, {props: {label: 'x'}})), /gap:10px/);
  } finally { result.dispose(); }
});
