const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs/promises');
const {Project, ts} = require('ts-morph');
const {parseDefineComponentMetadataCall} = require('../packages/codegen/src/annotations/parseRules.ts');
const {resolveComponentGroup, mergeComponentGroups} = require('../packages/codegen/src/annotations/groups.ts');
const {extractComponents} = require('../packages/codegen/src/extract.ts');
const {generateFiles} = require('../packages/codegen/src/generate.ts');
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'tests/fixtures/groups');
function project() {
  return new Project({compilerOptions: {strict: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true,
    esModuleInterop: true, baseUrl: root, paths: {'@reactive-forge/schema': ['packages/schema/src/index.ts'], '@/*': ['packages/schema/src/*']}}});
}

test('group membership and group acceptance survive extraction and generated registry output', async () => {
  const p = project(); p.addSourceFilesAtPaths(path.join(fixtures, '**/*.{ts,tsx}'));
  const components = extractComponents(p, [path.join(fixtures, 'src')]);
  const output = await fs.mkdtemp(path.join(root, '.cache-forge-groups-'));
  try {
    const config = {rootDir: fixtures, baseDir: fixtures, outDir: output, pathPrefix: '', annotationSources: {colocated: true}};
    await generateFiles(p, components, config, {info(){}});
    const metadata = JSON.parse(await fs.readFile(path.join(output, 'metadata.json'), 'utf8'));
    assert.equal(metadata.schemaVersion, 4);
    const link = metadata.components.find(c => c.name === 'MenuLink');
    assert.deepEqual(link.groups, [{kind:'group', id:'example/NavigationItem'}, {kind:'group', id:'forge/Text'}]);
    const description = metadata.components.find(c => c.name === 'Description');
    assert.deepEqual(description.slots[0].slot.accepts, [
      {kind:'group', id:'forge/Text'}, {kind:'group', id:'forge/RichText'},
      {kind:'group', id:'example/NavigationItem'}, {source:'project', id:link.id}]);
    const wrapper = await fs.readFile(path.join(output, '__reactive_forge_files/src/components.tsx.ts'), 'utf8');
    assert.match(wrapper, /groups:.*example\/NavigationItem/);
    const aggregate = await fs.readFile(path.join(output, 'index.ts'), 'utf8');
    assert.match(aggregate, /componentGroups:/); assert.match(aggregate, /forge\/RichText/);
    await generateFiles(p, components, {...config, annotationSources:{colocated:true, overrideSources:['override.ts']}}, {info(){}});
    const overridden = JSON.parse(await fs.readFile(path.join(output, 'metadata.json'), 'utf8'));
    assert.deepEqual(overridden.components.find(c => c.name === 'MenuLink').groups, []);
  } finally { assert.equal(path.dirname(output), root); assert.ok(path.basename(output).startsWith('.cache-forge-groups-')); await fs.rm(output, {recursive:true, force:true}); }
});

test('static groups support namespace imports, aliases, literals and reject spoofed helper calls', () => {
  const p = project();
  const file = p.createSourceFile(path.join(fixtures, 'resolution.ts'), `
    import * as Forge from '@reactive-forge/schema';
    import {defineComponentGroup as define, RichText as RT} from '@reactive-forge/schema';
    const custom = define('example/Custom'); const a = Forge.Text; const b = RT;
    const literal = {kind:'group', id:'example/Literal'} as const;
    function defineComponentGroup(id: string) { throw new Error('must not execute'); }
    const fake = defineComponentGroup('forge/RichText'); const invalid = define('example//Broken');
  `);
  const resolve = name => resolveComponentGroup(file.getVariableDeclarationOrThrow(name).getInitializerOrThrow());
  assert.deepEqual(resolve('custom'), {kind:'group', id:'example/Custom'});
  assert.deepEqual(resolve('a'), {kind:'group', id:'forge/Text'});
  assert.deepEqual(resolve('b'), {kind:'group', id:'forge/RichText'});
  assert.deepEqual(resolve('literal'), {kind:'group', id:'example/Literal'});
  assert.equal(resolve('fake'), undefined); assert.equal(resolve('invalid'), undefined);
});

test('group-only annotation activates metadata and same-layer membership conflicts are diagnosed', () => {
  const p = project(); const file = p.createSourceFile(path.join(fixtures, 'only.tsx'), `
    import {Text} from '@reactive-forge/schema';
    import {defineComponentMetadata} from '../../../packages/codegen/src/slotAuthoring';
    const Component = () => null; const metadata = defineComponentMetadata(Component, {groups:[Text]});
  `);
  const call = file.getVariableDeclarationOrThrow('metadata').getInitializerOrThrow();
  const parsed = parseDefineComponentMetadataCall(call, {rootDir:fixtures});
  assert.deepEqual(parsed.groups, [{kind:'group',id:'forge/Text'}]); assert.deepEqual(parsed.rules, []);
  const result = mergeComponentGroups([
    {componentId:'x', layer:'library', groups:[{kind:'group',id:'forge/Text'}]},
    {componentId:'x', layer:'library', groups:[]},
    {componentId:'x', layer:'project', groups:[]}
  ]);
  assert.deepEqual(result.groups, []); assert.equal(result.diagnostics[0].code, 'component-group-conflict');
});

test('legacy richText policy is diagnosed instead of becoming an accepted special value', () => {
  const p = project(); const file = p.createSourceFile(path.join(fixtures, 'legacy.ts'), `
    const C = () => null; const m = defineComponentMetadata(C, {rules:[{path:['children'], slot:{kind:'richText', inline:true}}]});
  `);
  const parsed = parseDefineComponentMetadataCall(file.getVariableDeclarationOrThrow('m').getInitializerOrThrow(), {rootDir:fixtures});
  assert.deepEqual(parsed.rules, []); assert.equal(parsed.diagnostics[0].code, 'legacy-rich-text-policy');
});

test('metadata containing only group declarations enables v4 without slot rules', async () => {
  const p = project(); p.addSourceFilesAtPaths(path.join(fixtures, 'groupOnly/*.tsx'));
  const components = extractComponents(p, [path.join(fixtures, 'groupOnly')]);
  const output = await fs.mkdtemp(path.join(root, '.cache-forge-groups-'));
  try {
    await generateFiles(p, components, {rootDir:fixtures, baseDir:fixtures, outDir:output, pathPrefix:'', annotationSources:{colocated:true}}, {info(){}});
    const metadata = JSON.parse(await fs.readFile(path.join(output,'metadata.json'),'utf8'));
    assert.equal(metadata.schemaVersion,4);
    assert.deepEqual(metadata.components[0].groups,[{kind:'group',id:'forge/Text'}]);
    assert.deepEqual(metadata.components[0].slots,[]);
  } finally { assert.equal(path.dirname(output),root); assert.ok(path.basename(output).startsWith('.cache-forge-groups-')); await fs.rm(output,{recursive:true,force:true}); }
});

test('external companion memberships support project replacement without importing external implementations', async () => {
  const p = project(); p.addSourceFilesAtPaths(path.join(fixtures, '*.ts'));
  const output = await fs.mkdtemp(path.join(root,'.cache-forge-groups-'));
  try {
    await generateFiles(p, [], {rootDir:path.join(root,'tests/fixtures/annotations'), baseDir:fixtures, outDir:output, pathPrefix:'',
      annotationSources:{colocated:false,libraries:[{package:'rf-fixture-widgets',metadataModule:path.join(fixtures,'external.ts')}],overrideSources:[path.join(fixtures,'externalOverride.ts')]}}, {info(){}});
    const metadata = JSON.parse(await fs.readFile(path.join(output,'metadata.json'),'utf8'));
    assert.equal(metadata.schemaVersion,4);
    assert.deepEqual(metadata.components[0].groups,[{kind:'group',id:'forge/Text'}]);
    const generated = await fs.readFile(path.join(output,'index.ts'),'utf8');
    assert.ok(!generated.includes('rf-fixture-widgets'));
    assert.match(generated,/forge\/Text/);
  } finally { assert.equal(path.dirname(output),root); assert.ok(path.basename(output).startsWith('.cache-forge-groups-')); await fs.rm(output,{recursive:true,force:true}); }
});
