const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Project, ts } = require('ts-morph');
const { extractComponents } = require('../packages/codegen/src/extract.ts');
const { generateFiles } = require('../packages/codegen/src/generate.ts');
const { ObjectSchema, c, registerCommonSchemas, schemaFromJson } = require('../packages/schema/src/index.ts');
registerCommonSchemas();
const root = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures/public-components');
async function removeTestOutput(directory) {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), root, 'Cleanup must remain directly inside the workspace');
  assert.ok(path.basename(target).startsWith('.cache-forge-test-'), 'Cleanup must target a generated test directory');
  await fs.rm(target, { recursive: true, force: true });
}
function project() {
  const result = new Project({ compilerOptions: { strict: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, esModuleInterop: true, baseUrl: root, paths: { '@reactive-forge/schema': ['packages/schema/src/index.ts'], '@/*': ['packages/schema/src/*'] } } });
  result.addSourceFilesAtPaths(path.join(fixtures, '*.{ts,tsx}'));
  return result;
}

test('E01: exported arrow/default components retain prop metadata and exclude private/non-callable exports', () => {
  const p = project();
  assert.equal(p.getPreEmitDiagnostics().length, 0, p.formatDiagnosticsWithColorAndContext(p.getPreEmitDiagnostics()));
  const components = extractComponents(p, [path.join(fixtures, 'cards.tsx')]);
  assert.deepEqual(components.map(c => [c.name, c.isDefault]), [['Card', false], ['DefaultCard', true]]);
  const args = components[0].args;
  assert.equal(args.title.required, true);
  assert.equal(args.title.schema.name, 'string');
  assert.equal(args.count.required, false);
  assert.equal(args.children.required, false);
  assert.equal(args.children.schema.name, 'reactNode');
  const restored = schemaFromJson(JSON.parse(JSON.stringify(new ObjectSchema(args).toJson())));
  assert.equal(restored.verifyConstructType(c.object({ title: c.string('Preview') })), true);
});

test('G01: generated manifest imports extracted components, typechecks and stays byte-identical on regeneration', async () => {
  const outDir = await fs.mkdtemp(path.join(root, '.cache-forge-test-'));
  try {
    const p = project();
    const components = extractComponents(p, [path.join(fixtures, 'cards.tsx')]);
    const config = { outDir, rootDir: fixtures, baseDir: fixtures, pathPrefix: 'fixture/' };
    const updates = [];
    const logger = { info: message => updates.push(message) };
    await generateFiles(p, components, config, logger);
    const wrapper = p.getSourceFileOrThrow(path.join(outDir, '__reactive_forge_files', 'cards.tsx.ts'));
    const imports = wrapper.getImportDeclarations().find(i => i.getDefaultImport());
    assert.ok(imports);
    assert.deepEqual(wrapper.getImportDeclarations()
      .filter(i => i.getModuleSpecifierValue() === imports.getModuleSpecifierValue())
      .flatMap(i => i.getNamedImports().map(named => named.getName())), ['Card']);
    const manifest = p.getSourceFileOrThrow(path.join(outDir, 'index.ts'));
    assert.ok(manifest.getVariableDeclaration('components'));
    const diagnostics = p.getPreEmitDiagnostics();
    assert.equal(diagnostics.length, 0, p.formatDiagnosticsWithColorAndContext(diagnostics));
    const before = await fs.readFile(wrapper.getFilePath(), 'utf8');
    updates.length = 0;
    await generateFiles(p, components, config, logger);
    assert.equal(await fs.readFile(wrapper.getFilePath(), 'utf8'), before);
    assert.deepEqual(updates, []);
  } finally {
    await removeTestOutput(outDir);
  }
});

test('E02: ordinary named function exports are discovered', () => {
  assert.deepEqual(extractComponents(project(), [path.join(fixtures, 'named.tsx')]).map(c => c.name), ['NamedCard']);
});

test('E03: configured entry files follow aliased barrel exports', () => {
  const components = extractComponents(project(), [path.join(fixtures, 'index.ts')]);
  assert.equal(components.length, 1, 'PublicCard must be discoverable through the configured entry');
  assert.equal(components[0].name, 'PublicCard');
  assert.equal(path.resolve(components[0].sourcePath), path.join(fixtures, 'index.ts'));
  assert.equal(components[0].args.title.required, true);
});

test('E04: extraction can run twice on the same project', () => {
  const p = project();
  const roots = [path.join(fixtures, 'cards.tsx')];
  const first = extractComponents(p, roots);
  let second;
  assert.doesNotThrow(() => { second = extractComponents(p, roots); });
  assert.deepEqual(second.map(c => c.name), first.map(c => c.name));
});

test('G02: a source file named components does not collide with the aggregate registry', async () => {
  const outDir = await fs.mkdtemp(path.join(root, '.cache-forge-test-'));
  try {
    const p = project();
    const source = path.join(fixtures, 'components.tsx');
    p.createSourceFile(source, 'export const Example = () => <div />;');
    const components = extractComponents(p, [source]);
    await generateFiles(p, components, { outDir, rootDir: fixtures, baseDir: fixtures, pathPrefix: 'fixture/' }, { info() {} });
    const diagnostics = p.getPreEmitDiagnostics();
    assert.equal(diagnostics.length, 0, p.formatDiagnosticsWithColorAndContext(diagnostics));
  } finally {
    await removeTestOutput(outDir);
  }
});

