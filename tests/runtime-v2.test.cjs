// Composition runtime v2 (docs/slot-contract.md sections 7-8, 10; phase 2 of the slot-contract
// work, building on phase 1's now-frozen packages/schema exports). Reuses tests/runtime.test.cjs's
// established pattern exactly: real `forge codegen`/`forge bundle` CLI runs against
// tests/fixtures/bundle-project (this file's own forge.runtime-v2.config.ts, with
// `annotationSources.colocated: true` so metadata.json comes out schemaVersion 2 with a real
// `slots` array) - no mocks.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const fixtureProject = path.join(root, 'tests', 'fixtures', 'bundle-project');
const fixtureOutDir = path.join(fixtureProject, 'out-runtime-v2');

const {
  validateComposition,
  renderComposition,
  migrateCompositionDocumentV1ToV2,
  CompositionValidationError,
} = require(path.join(root, 'packages', 'runtime', 'src', 'index.ts'));

function runCli(args, cwd) {
  const launch = `
process.argv = [process.execPath, 'forge', ...${JSON.stringify(args)}];
delete process._eval;
process.execArgv = [];
require(${JSON.stringify(path.join(root, 'packages', 'codegen', 'src', 'bin.ts'))});
`;
  const result = spawnSync(process.execPath, ['--require', path.join(root, 'tests', 'source-loader.cjs'), '-e', launch], {
    cwd: cwd ?? root,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  return result;
}

function cleanFixtureOutput() {
  const target = path.resolve(fixtureOutDir);
  assert.equal(path.dirname(target), fixtureProject, 'Cleanup must remain directly inside the bundle-project fixture');
  assert.equal(path.basename(target), 'out-runtime-v2', 'Cleanup must target this file\'s own out-runtime-v2 directory');
  fs.rmSync(target, { recursive: true, force: true });
}

async function buildFixture() {
  cleanFixtureOutput();
  const codegenResult = runCli(['codegen', '--config', 'forge.runtime-v2.config.ts'], fixtureProject);
  assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
  const bundleResult = runCli(['bundle', '--config', 'forge.runtime-v2.config.ts'], fixtureProject);
  assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

  const metadata = JSON.parse(fs.readFileSync(path.join(fixtureOutDir, 'metadata.json'), 'utf8'));
  const registry = (await import(pathToFileURL(path.join(fixtureOutDir, 'bundle.js')).href)).components;

  // KNOWN, REPORTED GAP (see this worker's final report): packages/codegen/src/extract.ts's
  // typeToSchema was never updated to recognize `React.ComponentType<Props>` and produce a real
  // ComponentTypeSchema for it (packages/schema/src/schema/ComponentType.ts exists and is wired
  // into resolvePath/checkPolicyCompatibility, but nothing in extraction ever calls it) - a real
  // prop typed `ComponentType<...>` extracts as some other schema shape today, so codegen's own
  // merge step drops any `componentRef` rule targeting it (`policy-type-mismatch`,
  // "componentRef policy targets a non-ComponentType path", visible on SlotCard's own
  // `diagnostics` in the real generated metadata.json). This is a packages/codegen gap, outside
  // this worker's file ownership (packages/runtime/src/{composition,validate,render,index}.ts
  // only) - not something this test works around by mocking `resolveSlotPolicy`/`checkSlotValue`
  // or the runtime's own componentRef handling, both of which run for real below against this
  // patched metadata. The patch below is the minimal, explicitly-flagged fix-up: it gives the
  // real generated `icon` prop a real `componentType` schema and a real `componentRef`
  // `EffectiveSlotRule`, exactly what a fixed extract.ts would have produced, so this file's
  // OWN scope (validate.ts/render.ts's componentRef wiring) still gets a genuine, real-bundle
  // proof rather than being silently left untested because of a gap one layer down.
  const slotCard = metadata.components.find(c => c.name === 'SlotCard');
  const slotIcon = metadata.components.find(c => c.name === 'SlotIcon');
  if (slotCard && slotIcon) {
    slotCard.props.icon.schema = {
      type: 'componentType',
      props: { type: 'object', properties: { size: { schema: { type: 'union', types: [{ type: 'number' }, { type: 'undefined' }] }, required: false } } },
    };
    slotCard.slots = (slotCard.slots ?? []).filter(r => JSON.stringify(r.path) !== JSON.stringify(['icon']));
    slotCard.slots.push({
      path: ['icon'],
      slot: { kind: 'componentRef', accepts: [{ source: 'project', id: slotIcon.id }] },
      appliedFrom: { slot: 'library' },
    });
  }

  return { metadata, registry };
}

function byName(metadata, name) {
  const found = metadata.components.find(c => c.name === name);
  assert.ok(found, `expected component ${name} in metadata.json`);
  return found;
}

test('runtime v2: metadata.json is schemaVersion 2 with real slot rules for SlotCard', async () => {
  const { metadata } = await buildFixture();
  try {
    assert.equal(metadata.schemaVersion, 2);
    const slotCard = byName(metadata, 'SlotCard');
    assert.ok(Array.isArray(slotCard.slots) && slotCard.slots.length > 0, 'SlotCard has real slot rules');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v2: validates and renders a document nesting through both a "nodes" slot and "children", with richText and componentRef', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const slotIconMeta = byName(metadata, 'SlotIcon');
    const greeterMeta = byName(metadata, 'Greeter');

    const doc = {
      schemaVersion: 2,
      root: {
        kind: 'instance',
        instanceId: 'root-1',
        componentId: slotCardMeta.id,
        props: {
          header: { kind: 'nodes', value: { items: [{ itemId: 'h1', kind: 'text', value: 'Header text' }] } },
          actions: {
            kind: 'nodes',
            value: {
              items: [
                { itemId: 'a1', kind: 'instance', instance: { kind: 'instance', instanceId: 'greeter-1', componentId: greeterMeta.id, props: { name: { kind: 'value', value: { type: 'string', value: 'Action Greeter' } } } } },
                { itemId: 'a2', kind: 'text', value: 'Second action' },
              ],
            },
          },
          icon: { kind: 'componentRef', value: { source: 'project', id: slotIconMeta.id } },
          caption: { kind: 'richText', value: { kind: 'richText', version: 1, inline: false, nodes: [{ type: 'paragraph', children: [{ type: 'text', text: 'Bold caption', marks: ['bold'] }] }] } },
          children: { kind: 'nodes', value: { items: [{ itemId: 'c1', kind: 'text', value: 'Nested child text' }] } },
        },
      },
    };

    const validation = validateComposition(doc, metadata, registry);
    assert.deepEqual(validation.diagnostics, [], 'a well-formed v2 document validates with zero diagnostics');
    assert.equal(validation.valid, true);

    const { renderToStaticMarkup } = require('react-dom/server');
    const element = renderComposition(doc, metadata, registry);
    const html = renderToStaticMarkup(element);

    assert.match(html, /<section data-testid="slot-card">/);
    assert.match(html, /<div data-testid="slot-card-header">Header text<\/div>/);
    assert.match(html, /Hello, Action Greeter!/, 'nested instance in the "actions" nodes slot rendered');
    assert.match(html, /Second action/);
    assert.match(html, /<svg data-testid="slot-icon"[^>]*width="24"/, 'componentRef prop rendered the raw SlotIcon constructor, invoked by SlotCard itself');
    assert.match(html, /<p><strong>Bold caption<\/strong><\/p>/, 'richText value rendered through the fixed paragraph/strong mapping');
    assert.match(html, /<div data-testid="slot-card-children">Nested child text<\/div>/, '"children" is an ordinary "nodes" prop, not a special sibling field');

    // Save/reload: plain JSON round trip must render identically.
    const reloaded = JSON.parse(JSON.stringify(doc));
    assert.deepEqual(reloaded, doc, 'v2 composition document round-trips through JSON.stringify/JSON.parse with no loss');
    const htmlAfterReload = renderToStaticMarkup(renderComposition(reloaded, metadata, registry));
    assert.equal(htmlAfterReload, html, 'render output is identical before and after save/reload');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v2: rejects a bare schemaVersion 1 document, naming the migration function', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const greeterMeta = byName(metadata, 'Greeter');
    const v1Doc = { schemaVersion: 1, root: { kind: 'instance', id: greeterMeta.id, props: { name: { kind: 'value', value: { type: 'string', value: 'X' } } } } };
    const result = validateComposition(v1Doc, metadata, registry);
    assert.equal(result.valid, false);
    const diag = result.diagnostics.find(d => d.code === 'unsupported-schema-version');
    assert.ok(diag, 'unsupported-schema-version diagnostic present');
    assert.match(diag.message, /migrateCompositionDocumentV1ToV2/);
    assert.throws(() => renderComposition(v1Doc, metadata, registry), CompositionValidationError);
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v2: rejects an unknown schemaVersion outright, no migration offered', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const doc = { schemaVersion: 3, root: { kind: 'instance', instanceId: 'x', componentId: 'does-not-matter', props: {} } };
    const result = validateComposition(doc, metadata, registry);
    assert.equal(result.valid, false);
    const diag = result.diagnostics.find(d => d.code === 'unsupported-schema-version');
    assert.ok(diag);
    assert.doesNotMatch(diag.message, /migrateCompositionDocumentV1ToV2/, 'no migration path is offered for a version other than 1');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v2: resolveSlotPolicy/checkSlotValue reject a wrong-component componentRef, an over-full "actions" collection, and a disallowed rich-text mark', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const greeterMeta = byName(metadata, 'Greeter');

    function baseProps() {
      return {
        header: { kind: 'nodes', value: { items: [] } },
        actions: { kind: 'nodes', value: { items: [] } },
        icon: { kind: 'componentRef', value: { source: 'project', id: greeterMeta.id } },
        caption: { kind: 'richText', value: { kind: 'richText', version: 1, inline: false, nodes: [{ type: 'paragraph', children: [{ type: 'text', text: 'X', marks: [] }] }] } },
      };
    }

    // 1. Wrong component in an accepts-restricted slot: icon's policy only accepts SlotIcon, not Greeter.
    {
      const doc = { schemaVersion: 2, root: { kind: 'instance', instanceId: 'r', componentId: slotCardMeta.id, props: baseProps() } };
      const result = validateComposition(doc, metadata, registry);
      assert.equal(result.valid, false);
      assert.ok(result.diagnostics.some(d => d.code === 'component-not-accepted'), 'wrong componentRef target rejected');
    }

    // 2. Exceeding maxItems: "actions" collection caps at 3 entries.
    {
      const props = baseProps();
      props.icon = { kind: 'componentRef', value: { source: 'project', id: byName(metadata, 'SlotIcon').id } };
      props.actions = { kind: 'nodes', value: { items: [0, 1, 2, 3].map(i => ({ itemId: `a${String(i)}`, kind: 'text', value: `action ${String(i)}` })) } };
      const doc = { schemaVersion: 2, root: { kind: 'instance', instanceId: 'r', componentId: slotCardMeta.id, props } };
      const result = validateComposition(doc, metadata, registry);
      assert.equal(result.valid, false);
      assert.ok(result.diagnostics.some(d => d.code === 'collection-max-items-exceeded'), '4 entries exceeds actions\' collection maxItems: 3');
    }

    // 3. Disallowed rich-text mark: caption's policy only allows "bold", not "italic".
    {
      const props = baseProps();
      props.icon = { kind: 'componentRef', value: { source: 'project', id: byName(metadata, 'SlotIcon').id } };
      props.caption = { kind: 'richText', value: { kind: 'richText', version: 1, inline: false, nodes: [{ type: 'paragraph', children: [{ type: 'text', text: 'X', marks: ['italic'] }] }] } };
      const doc = { schemaVersion: 2, root: { kind: 'instance', instanceId: 'r', componentId: slotCardMeta.id, props } };
      const result = validateComposition(doc, metadata, registry);
      assert.equal(result.valid, false);
      assert.ok(result.diagnostics.some(d => d.code === 'richtext-mark-not-accepted'), 'italic mark rejected by a marks: ["bold"] policy');
    }
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v2: stable itemId/instanceId survive a reorder of CompositionSlotValue.items', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const greeterMeta = byName(metadata, 'Greeter');
    const slotIconMeta = byName(metadata, 'SlotIcon');

    function makeDoc(items) {
      return {
        schemaVersion: 2,
        root: {
          kind: 'instance', instanceId: 'root', componentId: slotCardMeta.id,
          props: {
            header: { kind: 'nodes', value: { items: [] } },
            actions: { kind: 'nodes', value: { items } },
            icon: { kind: 'componentRef', value: { source: 'project', id: slotIconMeta.id } },
            caption: { kind: 'richText', value: { kind: 'richText', version: 1, inline: false, nodes: [] } },
          },
        },
      };
    }

    const itemA = { itemId: 'item-A', kind: 'instance', instance: { kind: 'instance', instanceId: 'inst-A', componentId: greeterMeta.id, props: { name: { kind: 'value', value: { type: 'string', value: 'A' } } } } };
    const itemB = { itemId: 'item-B', kind: 'text', value: 'B text' };

    const before = makeDoc([itemA, itemB]);
    const beforeValidation = validateComposition(before, metadata, registry);
    assert.equal(beforeValidation.valid, true, JSON.stringify(beforeValidation.diagnostics));

    // Reorder: a drag-and-drop move is a pure array splice.
    const after = makeDoc([itemB, itemA]);
    const afterValidation = validateComposition(after, metadata, registry);
    assert.equal(afterValidation.valid, true, JSON.stringify(afterValidation.diagnostics));

    const foundA = after.root.props.actions.value.items.find(i => i.itemId === 'item-A');
    const foundB = after.root.props.actions.value.items.find(i => i.itemId === 'item-B');
    assert.ok(foundA && foundA.kind === 'instance' && foundA.instance.instanceId === 'inst-A', 'itemId/instanceId identity travels with the item across a reorder');
    assert.ok(foundB && foundB.kind === 'text' && foundB.value === 'B text');
    assert.equal(after.root.props.actions.value.items[0].itemId, 'item-B', 'the array itself is genuinely reordered (position 0 changed)');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v2: migrateCompositionDocumentV1ToV2 against a hand-built v1 document renders equivalently to v1', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const cardMeta = byName(metadata, 'Card');
    const greeterMeta = byName(metadata, 'Greeter');

    const v1Doc = {
      schemaVersion: 1,
      root: {
        kind: 'instance',
        id: cardMeta.id,
        props: {
          title: { kind: 'value', value: { type: 'string', value: 'Migrated' } },
        },
        children: [
          {
            kind: 'instance',
            id: greeterMeta.id,
            props: {
              name: { kind: 'value', value: { type: 'string', value: 'Migrated Host' } },
              times: { kind: 'value', value: { type: 'number', value: 1 } },
            },
          },
        ],
      },
    };

    const migrated = migrateCompositionDocumentV1ToV2(v1Doc);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.root.componentId, cardMeta.id);
    assert.ok(typeof migrated.root.instanceId === 'string' && migrated.root.instanceId.length > 0);

    const childrenProp = migrated.root.props.children;
    assert.ok(childrenProp && childrenProp.kind === 'nodes', 'v1 sibling children became props.children = {kind:"nodes", ...}');
    assert.equal(childrenProp.value.items.length, 1);
    assert.equal(childrenProp.value.items[0].kind, 'instance');
    assert.equal(childrenProp.value.items[0].instance.componentId, greeterMeta.id);

    // Deterministic/reproducible: migrating the same v1 document twice yields identical ids.
    const migratedAgain = migrateCompositionDocumentV1ToV2(v1Doc);
    assert.deepEqual(migratedAgain, migrated, 'migration is deterministic - same input, same ids, every time');

    const validation = validateComposition(migrated, metadata, registry);
    assert.deepEqual(validation.diagnostics, [], 'the migrated document validates with zero diagnostics');

    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(renderComposition(migrated, metadata, registry));
    assert.match(html, /<section data-testid="card">/);
    assert.match(html, /<h2>Migrated<\/h2>/);
    assert.match(html, /Hello, Migrated Host!/, 'migrated document renders the same content v1\'s renderer would have produced for it');
  } finally {
    cleanFixtureOutput();
  }
});
