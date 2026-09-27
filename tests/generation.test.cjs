const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Project, ts } = require('ts-morph');
const { extractComponents } = require('../packages/codegen/src/extract.ts');
const { generateFiles } = require('../packages/codegen/src/generate.ts');
const { createCodegen } = require('../packages/codegen/src/index.ts');

const root = path.resolve(__dirname, '..');
const logger = { info() {} };

async function removeTestOutput(directory) {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), root, 'Cleanup must remain directly inside the workspace');
  assert.ok(path.basename(target).startsWith('.cache-forge-generation-'), 'Cleanup must target a generated test directory');
  await fs.rm(target, { recursive: true, force: true });
}

function project() {
  return new Project({ compilerOptions: {
    strict: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true, esModuleInterop: true, baseUrl: root,
    paths: { '@reactive-forge/schema': ['packages/schema/src/index.ts'], '@/*': ['packages/schema/src/*'] },
  } });
}

test('barrel exports, punctuation and source index resolve through the generated registry at runtime', async () => {
  const directory = await fs.mkdtemp(path.join(root, '.cache-forge-generation-'));
  try {
    const sourceRoot = path.join(directory, 'src');
    const outDir = path.join(directory, 'out');
    await fs.mkdir(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, 'a-b.tsx'), 'export const Thing = () => <div data-source="a-b" />;\n');
    await fs.writeFile(path.join(sourceRoot, 'a_b.tsx'), 'export const Thing = () => <div data-source="a_b" />;\n');
    await fs.writeFile(path.join(sourceRoot, 'components.tsx'), 'export const Example = () => <div data-source="components" />;\n');
    await fs.writeFile(path.join(sourceRoot, 'index.ts'), 'export { Thing as PublicThing, Thing as "__proto__" } from "./a-b";\n');

    const p = project();
    p.addSourceFilesAtPaths(path.join(sourceRoot, '*.{ts,tsx}'));
    const components = extractComponents(p, [sourceRoot]);
    await generateFiles(p, components, { outDir, rootDir: sourceRoot, baseDir: sourceRoot, pathPrefix: 'fixture/' }, logger);

    const diagnostics = p.getPreEmitDiagnostics();
    assert.equal(diagnostics.length, 0, p.formatDiagnosticsWithColorAndContext(diagnostics));
    const files = require(path.join(outDir, 'index.ts')).components.files;
    const byPath = Object.fromEntries(files.map(file => [file.path, file]));
    const original = require(path.join(sourceRoot, 'a-b.tsx')).Thing;
    assert.strictEqual(byPath['fixture/index'].components.PublicThing.component, original);
    assert.ok(Object.hasOwn(byPath['fixture/index'].components, '__proto__'));
    assert.strictEqual(byPath['fixture/index'].components.__proto__.component, original);
    assert.strictEqual(byPath['fixture/a-b'].components.Thing.component, original);
    assert.notStrictEqual(byPath['fixture/a-b'].components.Thing.component, byPath['fixture/a_b'].components.Thing.component);
    assert.equal(byPath['fixture/components'].components.Example.component().props['data-source'], 'components');
    assert.ok(await fs.stat(path.join(outDir, '__reactive_forge_files', 'index.ts.ts')));
  } finally {
    await removeTestOutput(directory);
  }
});

test('generation refuses unrelated output files and sources outside rootDir', async () => {
  const directory = await fs.mkdtemp(path.join(root, '.cache-forge-generation-'));
  try {
    const sourceRoot = path.join(directory, 'src');
    const outDir = path.join(directory, 'out');
    await fs.mkdir(sourceRoot);
    await fs.mkdir(outDir);
    const source = path.join(sourceRoot, 'entry.tsx');
    await fs.writeFile(source, 'export const Entry = () => <div />;\n');
    const p = project();
    p.addSourceFileAtPath(source);
    const components = extractComponents(p, [source]);
    const config = { outDir, rootDir: sourceRoot, baseDir: sourceRoot, pathPrefix: 'fixture/' };

    const aggregate = path.join(outDir, 'index.ts');
    await fs.writeFile(aggregate, 'const userContent = true;\n');
    await assert.rejects(generateFiles(p, components, config, logger), /Refusing to overwrite/);
    assert.equal(await fs.readFile(aggregate, 'utf8'), 'const userContent = true;\n');
    await assert.rejects(generateFiles(p, components, { ...config, rootDir: outDir }, logger), /outside rootDir/);
    await fs.rm(aggregate);

    await generateFiles(p, components, config, logger);
    const wrapper = path.join(outDir, '__reactive_forge_files', 'entry.tsx.ts');
    await fs.writeFile(wrapper, 'const userContent = true;\n');
    await assert.rejects(generateFiles(p, components, config, logger), /Refusing to overwrite/);
    assert.equal(await fs.readFile(wrapper, 'utf8'), 'const userContent = true;\n');
  } finally {
    await removeTestOutput(directory);
  }
});

test('createCodegen propagates a generation error to API callers', async () => {
  const directory = await fs.mkdtemp(path.join(root, '.cache-forge-generation-'));
  try {
    const sourceRoot = path.join(directory, 'src');
    const outDir = path.join(directory, 'out');
    await fs.mkdir(sourceRoot);
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(sourceRoot, 'entry.tsx'), 'export const Entry = () => <div />;\n');
    const tsConfigFilePath = path.join(directory, 'tsconfig.json');
    await fs.writeFile(tsConfigFilePath, JSON.stringify({
      compilerOptions: { strict: true, jsx: 'react-jsx', target: 'esnext', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true },
      include: ['src/**/*'],
    }));
    await fs.writeFile(path.join(outDir, 'index.ts'), 'const userContent = true;\n');
    const errors = [];
    const apiLogger = { info() {}, error: message => errors.push(message), timing: () => () => {} };
    await assert.rejects(createCodegen({
      tsConfigFilePath, typescriptLibPath: path.join(root, 'node_modules/typescript/lib'),
      componentRoots: [sourceRoot], outDir, rootDir: sourceRoot,
      baseDir: sourceRoot, pathPrefix: 'fixture/',
    }, apiLogger), /Refusing to overwrite/);
    assert.deepEqual(errors, [], 'API codegen leaves reporting to its caller');
  } finally {
    await removeTestOutput(directory);
  }
});
