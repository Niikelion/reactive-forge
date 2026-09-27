const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { Project, ts } = require('ts-morph');
const { extractComponents } = require('../packages/codegen/src/extract.ts');

const root = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures/discovery');

function project() {
  const result = new Project({
    compilerOptions: {
      strict: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      esModuleInterop: true,
    },
  });
  result.addSourceFilesAtPaths(path.join(fixtures, '**/*.{ts,tsx}'));
  return result;
}

function names(components) {
  return components.map(component => component.name).sort();
}

test('entry files follow multi-hop named, default, and anonymous reexports with public identities', () => {
  const entry = path.join(fixtures, 'entry.ts');
  const components = extractComponents(project(), [entry]);
  assert.deepEqual(names(components), ['Anonymous', 'PublicButton', 'PublicDefault']);
  assert.ok(components.every(component => component.sourcePath === entry.replace(/\\/g, '/')));
  assert.ok(components.every(component => !component.isDefault));
  assert.ok(components.every(component => component.args.label.required));

  const star = extractComponents(project(), [path.join(fixtures, 'star.ts')]);
  assert.deepEqual(names(star), ['Button']);
  assert.equal(star[0].sourcePath, path.join(fixtures, 'star.ts').replace(/\\/g, '/'));
});

test('type-only and ambient exports have no runtime component', () => {
  const roots = ['type-only.ts', 'import-type.ts', 'ambient.ts', 'parts/types.tsx'].map(name => path.join(fixtures, name));
  const components = extractComponents(project(), roots);
  assert.deepEqual(names(components), ['TypeOnly']);
});

test('default and named aliases remain distinct, including quoted public names', () => {
  const components = extractComponents(project(), [
    path.join(fixtures, 'collision.ts'),
    path.join(fixtures, 'literal.ts'),
    path.join(fixtures, 'parts/anonymous.tsx'),
  ]);
  const collision = components.filter(component => component.sourcePath.endsWith('/collision.ts'));
  assert.deepEqual(collision.map(component => [component.name, component.isDefault]).sort(), [
    ['DefaultButton', false],
    ['default', true],
  ]);
  assert.ok(components.some(component => component.name === 'foo-bar' && !component.isDefault));
  assert.ok(components.some(component => component.name === 'default' &&
    component.isDefault && component.sourcePath.endsWith('/parts/anonymous.tsx')));
});

test('directory roots use path boundaries and overlapping roots do not duplicate exports', () => {
  const widgets = path.join(fixtures, 'selected/widgets');
  const components = extractComponents(project(), [widgets, widgets, path.join(widgets, 'local.tsx')]);
  assert.deepEqual(names(components), ['Local', 'LocalAlias', 'NamedLocal']);
  assert.ok(!components.some(component => component.name === 'Extra'));
  assert.equal(new Set(components.map(component => `${component.sourcePath}:${component.name}`)).size, components.length);
});

test('repeated extraction leaves an existing helper-named source file untouched', () => {
  const p = project();
  const helper = p.getSourceFileOrThrow(path.join(fixtures, '__reactive_forge_utils_tmp_file.ts'));
  const original = helper.getFullText();
  const entry = path.join(fixtures, 'entry.ts');
  const first = extractComponents(p, [entry]);
  const second = extractComponents(p, [entry]);
  assert.deepEqual(names(second), names(first));
  assert.equal(helper.getFullText(), original);
  assert.equal(p.getSourceFiles().filter(source => source.getBaseName().startsWith('__reactive_forge_utils_tmp_file_')).length, 0);
});

test('failed React type resolution also removes the temporary helper', () => {
  const p = new Project({ useInMemoryFileSystem: true });
  const source = path.join(fixtures, 'missing-react.tsx');
  p.createSourceFile(source, 'export function Missing() { return null; }');
  assert.throws(() => extractComponents(p, [source]), /Cannot find react types/);
  assert.deepEqual(p.getSourceFiles().map(file => file.getFilePath()), [source.replace(/\\/g, '/')]);
});
