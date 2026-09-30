// Tests for docs/slot-contract.md sections 4-5, implemented in
// packages/codegen/src/{annotations/**,slotTypes.ts,slotAuthoring.ts}.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Project, ts } = require('ts-morph');
const { extractComponents } = require('../packages/codegen/src/extract.ts');
const { generateFiles } = require('../packages/codegen/src/generate.ts');

const root = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures/annotations');
const logger = { info() {} };

async function removeTestOutput(directory) {
  const target = path.resolve(directory);
  assert.equal(path.dirname(target), root, 'Cleanup must remain directly inside the workspace');
  assert.ok(path.basename(target).startsWith('.cache-forge-annotations-'), 'Cleanup must target a generated test directory');
  await fs.rm(target, { recursive: true, force: true });
}

function project() {
  return new Project({
    compilerOptions: {
      strict: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true, esModuleInterop: true, baseUrl: root,
      paths: { '@reactive-forge/schema': ['packages/schema/src/index.ts'], '@/*': ['packages/schema/src/*'] },
    },
  });
}

function byName(components, name) {
  const found = components.find(c => c.name === name);
  assert.ok(found, `expected a component named ${name}`);
  return found;
}

async function generate(config) {
  const p = project();
  p.addSourceFilesAtPaths(path.join(fixtures, '**/*.{ts,tsx}'));
  const components = extractComponents(p, [path.join(fixtures, 'src')]);
  const directory = await fs.mkdtemp(path.join(root, '.cache-forge-annotations-'));
  const outDir = path.join(directory, 'out');
  try {
    await generateFiles(p, components, {
      outDir, rootDir: fixtures, baseDir: path.join(fixtures, 'src'), pathPrefix: 'fixture/',
      ...config,
    }, logger);
    const document = JSON.parse(await fs.readFile(path.join(outDir, 'metadata.json'), 'utf8'));
    return { document, components };
  } finally {
    await removeTestOutput(directory);
  }
}

test('a colocated defineComponentMetadata call (same file) produces the right SlotRules in metadata.json', async () => {
  const { document } = await generate({ annotationSources: { colocated: true } });
  assert.equal(document.schemaVersion, 2);
  const card = document.components.find(c => c.name === 'Card');
  assert.ok(card, 'Card is present');
  assert.ok(Array.isArray(card.slots), 'Card has a slots array');

  const actionsRule = card.slots.find(r => JSON.stringify(r.path) === JSON.stringify(['actions']));
  assert.ok(actionsRule, 'a rule targets ["actions"]');
  assert.deepEqual(actionsRule.collection, { maxItems: 3 });
  assert.equal(actionsRule.appliedFrom.collection, 'library');

  const actionsEachRule = card.slots.find(r => JSON.stringify(r.path) === JSON.stringify(['actions', { kind: 'each' }]));
  assert.ok(actionsEachRule, 'a rule targets ["actions", each()]');
  assert.deepEqual(actionsEachRule.slot, { kind: 'any', maxItems: 1 });
  assert.equal(actionsEachRule.appliedFrom.slot, 'library');
});

test('a *.metadata.ts sibling file and a project override source at the same path prove precedence (project wins)', async () => {
  const { document } = await generate({
    annotationSources: {
      colocated: true,
      overrideSources: [path.join(fixtures, 'overrides', 'panelOverride.ts')],
    },
  });
  const panel = document.components.find(c => c.name === 'Panel');
  assert.ok(panel, 'Panel is present');
  const bodyRule = panel.slots.find(r => JSON.stringify(r.path) === JSON.stringify(['body']));
  assert.ok(bodyRule, 'a rule targets ["body"]');
  // Library layer (Panel.metadata.ts) set maxItems: 2; project override sets maxItems: 9 at the
  // same path - project must win.
  assert.equal(bodyRule.slot.maxItems, 9);
  assert.equal(bodyRule.appliedFrom.slot, 'project');
});

test('two same-layer rules at the same path produce a slot-rule-conflict diagnostic; the first rule wins', async () => {
  const { document } = await generate({ annotationSources: { colocated: true } });
  const toolbar = document.components.find(c => c.name === 'Toolbar');
  assert.ok(toolbar, 'Toolbar is present');
  assert.ok(toolbar.diagnostics.some(d => d.code === 'slot-rule-conflict' && d.severity === 'error'),
    'component diagnostics include slot-rule-conflict');
  const itemsRule = toolbar.slots.find(r => JSON.stringify(r.path) === JSON.stringify(['items']));
  assert.ok(itemsRule);
  assert.equal(itemsRule.slot.maxItems, 2, 'the first rule to set maxItems wins');
});

test('a dynamically-constructed rules array is diagnosed unsupported-annotation-expression and never evaluated', async () => {
  const { document } = await generate({ annotationSources: { colocated: true } });
  const dynamic = document.components.find(c => c.name === 'Dynamic');
  assert.ok(dynamic, 'Dynamic is present');
  assert.ok(dynamic.diagnostics.some(d => d.code === 'unsupported-annotation-expression' && d.severity === 'warning'));
  assert.deepEqual(dynamic.slots, [], 'the dynamically-built rule was never applied');
});

test('a companion library-metadata module produces a correct external-identity ComponentMetadata entry, with zero project-source execution', async () => {
  const { document } = await generate({
    annotationSources: {
      colocated: false,
      libraries: [{ package: 'rf-fixture-widgets', metadataModule: path.join(fixtures, 'libraryMeta', 'widgetsMeta.ts') }],
    },
  });
  // If external resolution ever `require`d/`import`ed rf-fixture-widgets/index.js, that module's
  // own top-level `throw` would have failed this whole test run already - reaching this line at
  // all is part of the proof.
  assert.equal(document.schemaVersion, 2);
  const externalLibrary = document.externalLibraries.find(l => l.package === 'rf-fixture-widgets');
  assert.ok(externalLibrary, 'externalLibraries includes rf-fixture-widgets');
  assert.equal(externalLibrary.resolvedVersion, '1.2.0');
  assert.deepEqual(externalLibrary.diagnostics.filter(d => d.severity === 'error').map(d => d.code), ['external-export-missing']);

  const button = document.components.find(c => c.external && c.external.exportName === 'Button');
  assert.ok(button, 'Button external component is present');
  assert.deepEqual(button.external, { source: 'external', package: 'rf-fixture-widgets', exportName: 'Button', isDefault: false });
  assert.ok(button.sourcePath.endsWith('index.d.ts'), 'sourcePath points at the resolved .d.ts, for diagnostics only');
  assert.ok('icon' in button.props, 'the external component\'s props were extracted from its .d.ts via the same typeToSchema pipeline');
  assert.equal(button.props.label.required, true);
  const iconRule = button.slots.find(r => JSON.stringify(r.path) === JSON.stringify(['icon']));
  assert.ok(iconRule, 'a rule targets external Button\'s ["icon"] path');
  assert.deepEqual(iconRule.slot, { kind: 'any', maxItems: 1 });

  // The synthetic MissingExport entry never appears in components[].
  assert.ok(!document.components.some(c => c.external && c.external.exportName === 'MissingExport'));
});

test('an incompatible library version produces library-version-incompatible and excludes that library\'s rules', async () => {
  const { document } = await generate({
    annotationSources: {
      colocated: false,
      libraries: [{ package: 'rf-fixture-widgets-old', metadataModule: path.join(fixtures, 'libraryMeta', 'widgetsMetaOld.ts') }],
    },
  });
  const ref = document.externalLibraries.find(l => l.package === 'rf-fixture-widgets-old');
  assert.ok(ref);
  assert.equal(ref.resolvedVersion, '0.5.0');
  assert.ok(ref.diagnostics.some(d => d.code === 'library-version-incompatible' && d.severity === 'error'));
  assert.ok(!document.components.some(c => c.external && c.external.package === 'rf-fixture-widgets-old'));
});

test('an unresolvable package produces library-not-found', async () => {
  const { document } = await generate({
    annotationSources: {
      colocated: false,
      libraries: [{ package: 'rf-fixture-does-not-exist', metadataModule: path.join(fixtures, 'libraryMeta', 'widgetsMetaMissingPackage.ts') }],
    },
  });
  const ref = document.externalLibraries.find(l => l.package === 'rf-fixture-does-not-exist');
  assert.ok(ref);
  assert.equal(ref.resolvedVersion, undefined);
  assert.ok(ref.diagnostics.some(d => d.code === 'library-not-found' && d.severity === 'error'));
});

test('a project that configures no annotation sources still produces a plain v1 metadata document', async () => {
  const { document } = await generate({});
  assert.equal(document.schemaVersion, 1);
  assert.ok(!('slots' in document.components.find(c => c.name === 'Card')));
  assert.equal(document.externalLibraries, undefined);
});
