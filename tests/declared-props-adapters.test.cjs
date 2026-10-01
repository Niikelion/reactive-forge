const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {exportToTsx, renderComposition} = require('../packages/runtime/src/index.ts');

test('class, literal object and tuple public defaults preserve declared types and runtime parity', () => {
  const scratch = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'declared-adapters-'));
  try {
    const string = {type: 'string'};
    const number = {type: 'number'};
    const array = (indexType, tupleTypes = []) => ({type: 'array', tupleTypes, ...(indexType ? {indexType} : {})});
    const instance = (name, typeArguments, payloadSchema) => ({type: 'instance', typeRef: {kind: 'builtin', name}, typeArguments, adapter: {id: `builtin/${name}`, version: 1}, payloadSchema});
    const map = instance('Map', [string, number], array(array(undefined, [string, number])));
    const set = instance('Set', [string], array(string));
    const badge = {type: 'object', properties: {kind: {schema: {type: 'string', literal: 'badge'}, required: true}}};
    const pair = array(undefined, [string, number]);
    const props = {map: {schema: map, required: true}, set: {schema: set, required: true}, badge: {schema: badge, required: true}, pair: {schema: pair, required: true}};
    const hostPath = path.join(scratch, 'AdapterHost.tsx');
    fs.writeFileSync(hostPath, 'export function AdapterHost({map,set,badge,pair}:{map:Map<string,number>;set:Set<string>;badge:{kind:"badge"};pair:[string,number]}) {return <p>{map.get("total")}:{[...set].join(",")}:{badge.kind}:{pair[1]}</p>}');
    const metadata = {schemaVersion: 4, generatedAt: '2026-10-01T00:00:00Z', components: [{id: 'host', name: 'AdapterHost', sourcePath: 'AdapterHost.tsx', isDefault: false, props: Object.fromEntries(Object.entries(props).map(([name, prop]) => [name, {...prop, diagnostics: []}])), diagnostics: [], slots: []}]};
    const library = {files: [{path: 'AdapterHost.tsx', components: {AdapterHost: {id: 'host', component: require(hostPath).AdapterHost, args: {type: 'object', properties: props}}}}]};
    const doc = {
      schemaVersion: 5,
      props: {
        map: {...props.map, required: false, defaultValue: {type: 'instance', adapterId: 'builtin/Map', version: 1, value: {type: 'array', value: [{type: 'array', value: [{type: 'string', value: 'total'}, {type: 'number', value: 7}]}]}}},
        set: {...props.set, required: false, defaultValue: {type: 'instance', adapterId: 'builtin/Set', version: 1, value: {type: 'array', value: [{type: 'string', value: 'a'}, {type: 'string', value: 'b'}]}}},
        genericMap: {schema: {...map, typeArguments: []}, required: false},
        genericSet: {schema: {...set, typeArguments: []}, required: false},
        badge: {...props.badge, required: false, defaultValue: {type: 'object', value: {kind: {type: 'string', value: 'badge'}}}},
        pair: {...props.pair, required: false, defaultValue: {type: 'array', value: [{type: 'string', value: 'pair'}, {type: 'number', value: 3}]}},
      },
      root: {kind: 'instance', instanceId: 'host', componentId: 'host', props: Object.fromEntries(['map', 'set', 'badge', 'pair'].map(name => [name, {kind: 'prop', name}]))},
    };
    const generated = path.join(scratch, 'Generated.tsx');
    fs.writeFileSync(generated, exportToTsx(doc, metadata, library, {resolveImportPath: () => './AdapterHost'}));
    const program = ts.createProgram([generated], {strict: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, skipLibCheck: true});
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    const actual = renderToStaticMarkup(React.createElement(require(generated).default));
    assert.equal(actual, '<p>7:a,b:badge:3</p>');
    assert.equal(actual, renderToStaticMarkup(renderComposition(doc, metadata, library)));
  } finally { fs.rmSync(scratch, {recursive: true, force: true}); }
});
