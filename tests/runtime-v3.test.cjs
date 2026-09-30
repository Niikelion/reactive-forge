// Recursive composition values and policy enforcement (docs/slot-contract-recursive.md; required
// repair #1, docs/claude-slots-repair.md). Reuses tests/runtime-v2.test.cjs's established pattern
// exactly: real `forge codegen`/`forge bundle` CLI runs against tests/fixtures/bundle-project (this
// file's own forge.runtime-v3.config.ts, `annotationSources.colocated: true`) - no mocks. Exercises
// NestedSlotCard.tsx (added for this file) for the two nested-path shapes the contract's worked
// examples need that no pre-existing fixture had: content.header.title (8.1) and
// sections.each().body (8.2), plus actions (8.3, the literal flat-array-gap closure).
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const fixtureProject = path.join(root, 'tests', 'fixtures', 'bundle-project');
const fixtureOutDir = path.join(fixtureProject, 'out-runtime-v3');

const {
  validateComposition,
  renderComposition,
  exportToTsx,
  migrateCompositionDocumentV1ToV2,
  migrateCompositionDocumentV2ToV3,
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
  assert.equal(path.basename(target), 'out-runtime-v3', 'Cleanup must target this file\'s own out-runtime-v3 directory');
  fs.rmSync(target, { recursive: true, force: true });
}

async function buildFixture() {
  cleanFixtureOutput();
  const codegenResult = runCli(['codegen', '--config', 'forge.runtime-v3.config.ts'], fixtureProject);
  assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
  const bundleResult = runCli(['bundle', '--config', 'forge.runtime-v3.config.ts'], fixtureProject);
  assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

  const metadata = JSON.parse(fs.readFileSync(path.join(fixtureOutDir, 'metadata.json'), 'utf8'));
  const registry = (await import(pathToFileURL(path.join(fixtureOutDir, 'bundle.js')).href)).components;
  return { metadata, registry };
}

function byName(metadata, name) {
  const found = metadata.components.find(c => c.name === name);
  assert.ok(found, `expected component ${name} in metadata.json`);
  return found;
}

test('runtime v3: metadata.json carries real nested slot rules for NestedSlotCard (content.header.title, sections.each().body, actions.each())', async () => {
  const { metadata } = await buildFixture();
  try {
    const nested = byName(metadata, 'NestedSlotCard');
    assert.ok(Array.isArray(nested.slots) && nested.slots.length > 0);
    assert.ok(nested.slots.some(r => JSON.stringify(r.path) === JSON.stringify(['content', 'header', 'title']) && r.slot?.kind === 'richText'));
    assert.ok(nested.slots.some(r => JSON.stringify(r.path) === JSON.stringify(['sections', { kind: 'each' }, 'body']) && r.slot?.kind === 'any'));
    assert.ok(nested.slots.some(r => JSON.stringify(r.path) === JSON.stringify(['actions', { kind: 'each' }]) && r.slot?.kind === 'any' && r.slot.maxItems === 2));
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: validates/renders/exports worked examples 8.1 (nested object), 8.2 (array of objects), and 8.3 (multi-node array entry) for real', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const greeterMeta = byName(metadata, 'Greeter');

    const doc = {
      schemaVersion: 3,
      root: {
        kind: 'instance',
        instanceId: 'root-1',
        componentId: nestedMeta.id,
        props: {
          // 8.1: content.header.title (richText, inline) nested through two plain "object" wrappers.
          content: {
            kind: 'composed',
            value: {
              kind: 'object',
              fields: {
                header: {
                  kind: 'object',
                  fields: {
                    title: { kind: 'richText', value: { kind: 'richText', version: 1, inline: true, nodes: [{ type: 'text', text: 'Hello', marks: ['bold'] }] } },
                    subtitle: { kind: 'leaf', value: { type: 'string', value: 'A subtitle' } },
                  },
                },
              },
            },
          },
          // 8.2: sections.each().body - one section entry whose OWN body slot independently holds
          // 2 nodes (a nested Greeter instance and a text item), while heading is a plain leaf.
          sections: {
            kind: 'composed',
            value: {
              kind: 'array',
              items: [
                {
                  itemId: 'sec-1',
                  value: {
                    kind: 'object',
                    fields: {
                      heading: { kind: 'leaf', value: { type: 'string', value: 'Intro' } },
                      body: {
                        kind: 'nodes',
                        value: {
                          items: [
                            { itemId: 'body-1a', kind: 'instance', instance: { kind: 'instance', instanceId: 'sec-greeter', componentId: greeterMeta.id, props: { name: { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'Section Greeter' } } } } } },
                            { itemId: 'body-1b', kind: 'text', value: 'trailing section text' },
                          ],
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
          // 8.3: actions - action-1's SINGLE array entry holds 2 rendered nodes (Fragment-wrapped),
          // action-2's entry holds exactly 1 (bare) - the literal v2-flat-array-gap closure.
          actions: {
            kind: 'composed',
            value: {
              kind: 'array',
              items: [
                {
                  itemId: 'action-1',
                  value: {
                    kind: 'nodes',
                    value: {
                      items: [
                        { itemId: 'btn-1', kind: 'instance', instance: { kind: 'instance', instanceId: 'act-greeter-1', componentId: greeterMeta.id, props: { name: { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'First' } } } } } },
                        { itemId: 'btn-2', kind: 'instance', instance: { kind: 'instance', instanceId: 'act-greeter-2', componentId: greeterMeta.id, props: { name: { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'Second' } } } } } },
                      ],
                    },
                  },
                },
                {
                  itemId: 'action-2',
                  value: { kind: 'nodes', value: { items: [{ itemId: 'txt-1', kind: 'text', value: 'Cancel' }] } },
                },
              ],
            },
          },
        },
      },
    };

    const validation = validateComposition(doc, metadata, registry);
    assert.deepEqual(validation.diagnostics, [], 'a well-formed v3 document validates with zero diagnostics');
    assert.equal(validation.valid, true);

    const { renderToStaticMarkup } = require('react-dom/server');
    const element = renderComposition(doc, metadata, registry);
    const html = renderToStaticMarkup(element);

    // 8.1
    assert.match(html, /<div data-testid="nested-slot-card-title"><strong>Hello<\/strong><\/div>/, 'content.header.title rendered through the richText path, nested two object levels deep');
    assert.match(html, /<div data-testid="nested-slot-card-subtitle">A subtitle<\/div>/);

    // 8.2
    assert.match(html, /<span data-testid="nested-slot-card-section-heading">Intro<\/span>/);
    assert.match(html, /Hello, Section Greeter!/, 'the nested instance inside sections[0].body rendered');
    assert.match(html, /trailing section text/, 'the second, independent item inside sections[0].body rendered alongside the first');

    // 8.3 - the byte-level assertion that more than one node renders inside a SINGLE array entry,
    // something v2's flat CompositionSlotItem[]-per-prop shape could never produce.
    const actionsHtml = html.match(/<div data-testid="nested-slot-card-actions">([\s\S]*?)<\/div>\s*<\/section>/)[1];
    assert.match(actionsHtml, /Hello, First!/);
    assert.match(actionsHtml, /Hello, Second!/);
    assert.match(actionsHtml, /Cancel/);
    const firstIndex = actionsHtml.indexOf('Hello, First!');
    const secondIndex = actionsHtml.indexOf('Hello, Second!');
    const cancelIndex = actionsHtml.indexOf('Cancel');
    assert.ok(firstIndex >= 0 && secondIndex > firstIndex && cancelIndex > secondIndex, 'action-1\'s 2 nodes render in order, followed by action-2\'s single node - one array entry genuinely holding 2 rendered nodes');

    // Save/reload: plain JSON round trip must render identically.
    const reloaded = JSON.parse(JSON.stringify(doc));
    assert.deepEqual(reloaded, doc, 'v3 composition document round-trips through JSON.stringify/JSON.parse with no loss');
    const htmlAfterReload = renderToStaticMarkup(renderComposition(reloaded, metadata, registry));
    assert.equal(htmlAfterReload, html, 'render output is identical before and after save/reload');

    // Export mirrors rendering exactly, in source-text form, including the per-entry Fragment
    // wrapping serializeSlotArrayExpression (v2) could never produce for a single array entry.
    const tsx = exportToTsx(doc, metadata, registry);
    assert.match(tsx, /import \{ Greeter \} from/, 'Greeter imported exactly once despite 3 distinct nested instances');
    assert.match(tsx, /actions=\{\[<><Greeter name="First" \/><Greeter name="Second" \/><\/>, <>\{"Cancel"\}<\/>\]\}/, 'actions serializes as a real array literal whose first element is a real multi-child Fragment (2 nodes) - the flat-array-gap closure in source-text form; the second entry is ALSO Fragment-wrapped since this slot\'s policy sets multiple:true explicitly');
    assert.match(tsx, /content=\{\{header: \{title: <><strong>\{"Hello"\}<\/strong><\/>, subtitle: "A subtitle"\}\}\}/, 'content serializes as a nested object literal, with title\'s richText value emitted as literal JSX source');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: rejects a "leaf" value containing a legacy "element" node anywhere inside it', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const doc = {
      schemaVersion: 3,
      root: {
        kind: 'instance',
        instanceId: 'root-1',
        componentId: nestedMeta.id,
        props: {
          content: {
            kind: 'composed',
            value: {
              kind: 'object',
              fields: {
                header: {
                  kind: 'object',
                  fields: {
                    title: { kind: 'richText', value: { kind: 'richText', version: 1, inline: true, nodes: [] } },
                    // subtitle is a plain string prop (non-slot-domain) - a "leaf" holding a legacy
                    // "element" reference must be rejected, never silently rendered as a bypass.
                    subtitle: { kind: 'leaf', value: { type: 'element', value: { path: 'does-not-matter.tsx', name: 'DoesNotMatter', args: {} } } },
                  },
                },
              },
            },
          },
          sections: { kind: 'composed', value: { kind: 'array', items: [] } },
          actions: { kind: 'composed', value: { kind: 'array', items: [] } },
        },
      },
    };

    const result = validateComposition(doc, metadata, registry);
    assert.equal(result.valid, false);
    const diag = result.diagnostics.find(d => d.code === 'legacy-element-value-forbidden');
    assert.ok(diag, 'legacy-element-value-forbidden diagnostic present');
    assert.match(diag.path, /content\.header\.subtitle/);
    assert.throws(() => renderComposition(doc, metadata, registry), CompositionValidationError);
    assert.throws(() => exportToTsx(doc, metadata, registry), CompositionValidationError);
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: rejects bare schemaVersion 1/2 documents, naming the required migration call(s)', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const greeterMeta = byName(metadata, 'Greeter');

    const v1Doc = { schemaVersion: 1, root: { kind: 'instance', id: greeterMeta.id, props: { name: { kind: 'value', value: { type: 'string', value: 'X' } } } } };
    const v1Result = validateComposition(v1Doc, metadata, registry);
    assert.equal(v1Result.valid, false);
    const v1Diag = v1Result.diagnostics.find(d => d.code === 'unsupported-schema-version');
    assert.ok(v1Diag);
    assert.match(v1Diag.message, /migrateCompositionDocumentV1ToV2/);
    assert.match(v1Diag.message, /migrateCompositionDocumentV2ToV3/);
    assert.throws(() => renderComposition(v1Doc, metadata, registry), CompositionValidationError);
    // exportToTsx's own version gate throws a plain Error (no CompositionDiagnostic machinery of
    // its own for a version mismatch - matches the v2 exporter's established behavior).
    assert.throws(() => exportToTsx(v1Doc, metadata, registry), /schemaVersion 1 is not accepted/);

    const v2Doc = { schemaVersion: 2, root: { kind: 'instance', instanceId: 'r', componentId: greeterMeta.id, props: { name: { kind: 'value', value: { type: 'string', value: 'X' } } } } };
    const v2Result = validateComposition(v2Doc, metadata, registry);
    assert.equal(v2Result.valid, false);
    const v2Diag = v2Result.diagnostics.find(d => d.code === 'unsupported-schema-version');
    assert.ok(v2Diag);
    assert.doesNotMatch(v2Diag.message, /migrateCompositionDocumentV1ToV2/, 'no v1 migration is offered for a v2 document');
    assert.match(v2Diag.message, /migrateCompositionDocumentV2ToV3/);
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: migrateCompositionDocumentV2ToV3 - lossless leaf-wrap case (Greeter.name, non-slot-domain plain string)', async () => {
  const { metadata } = await buildFixture();
  try {
    const greeterMeta = byName(metadata, 'Greeter');
    const v2Doc = {
      schemaVersion: 2,
      root: { kind: 'instance', instanceId: 'g1', componentId: greeterMeta.id, props: { name: { kind: 'value', value: { type: 'string', value: 'A' } } } },
    };
    const result = migrateCompositionDocumentV2ToV3(v2Doc, metadata);
    assert.deepEqual(result.diagnostics, [], 'a plain non-slot-domain value needs no judgment call and is not discarded');
    assert.equal(result.document.schemaVersion, 3);
    assert.deepEqual(result.document.root.props.name, { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'A' } } });
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: migrateCompositionDocumentV2ToV3 - mechanical lift of a plain string to richText at content.header.title', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const v2Doc = {
      schemaVersion: 2,
      root: {
        kind: 'instance',
        instanceId: 'n1',
        componentId: nestedMeta.id,
        props: {
          content: { kind: 'value', value: { type: 'object', value: { header: { type: 'object', value: { title: { type: 'string', value: 'Plain title' }, subtitle: { type: 'string', value: 'Sub' } } } } } },
          sections: { kind: 'value', value: { type: 'array', value: [] } },
          actions: { kind: 'value', value: { type: 'array', value: [] } },
        },
      },
    };
    const result = migrateCompositionDocumentV2ToV3(v2Doc, metadata);
    assert.deepEqual(result.diagnostics, [], 'a mechanical string -> richText lift is deterministic and lossless, not a discard');
    assert.deepEqual(result.document.root.props.content, {
      kind: 'composed',
      value: {
        kind: 'object',
        fields: {
          header: {
            kind: 'object',
            fields: {
              title: { kind: 'richText', value: { kind: 'richText', version: 1, inline: true, nodes: [{ type: 'text', text: 'Plain title', marks: [] }] } },
              subtitle: { kind: 'leaf', value: { type: 'string', value: 'Sub' } },
            },
          },
        },
      },
    });

    const validation = validateComposition(result.document, metadata, registry);
    assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: migrateCompositionDocumentV2ToV3 - discard-with-diagnostic (non-string value at a ReactNode-policy path)', async () => {
  const { metadata } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const v2Doc = {
      schemaVersion: 2,
      root: {
        kind: 'instance',
        instanceId: 'n1',
        componentId: nestedMeta.id,
        props: {
          content: { kind: 'value', value: { type: 'object', value: { header: { type: 'object', value: { title: { type: 'string', value: 'T' }, subtitle: { type: 'string', value: 'S' } } } } } },
          // sections[0].body is ReactNode-domain (any, multiple) per current metadata; a NUMBER
          // stored there has no sensible mechanical lift and must be discarded with a diagnostic.
          sections: { kind: 'value', value: { type: 'array', value: [{ type: 'object', value: { heading: { type: 'string', value: 'H' }, body: { type: 'number', value: 42 } } }] } },
          actions: { kind: 'value', value: { type: 'array', value: [] } },
        },
      },
    };
    const result = migrateCompositionDocumentV2ToV3(v2Doc, metadata);
    const discardDiag = result.diagnostics.find(d => d.code === 'migrated-value-discarded');
    assert.ok(discardDiag, 'a real migrated-value-discarded diagnostic is present');
    assert.match(discardDiag.path, /sections/);
    assert.match(discardDiag.message, /42/);

    const sectionsValue = result.document.root.props.sections.value;
    assert.equal(sectionsValue.kind, 'array');
    const bodyValue = sectionsValue.items[0].value.fields.body;
    assert.deepEqual(bodyValue, { kind: 'nodes', value: { items: [] } }, 'the non-string value was discarded to an empty nodes slot, not silently coerced');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: migrateCompositionDocumentV2ToV3 - discard-with-diagnostic (legacy "element" at a non-slot-domain path)', async () => {
  const { metadata } = await buildFixture();
  try {
    const greeterMeta = byName(metadata, 'Greeter');
    const v2Doc = {
      schemaVersion: 2,
      root: {
        kind: 'instance',
        instanceId: 'g1',
        componentId: greeterMeta.id,
        // Greeter.name is a plain string prop (non-slot-domain) - a legacy "element" reference
        // stored there (a pre-existing malformed document) cannot be mechanically converted.
        props: { name: { kind: 'value', value: { type: 'element', value: { path: 'does-not-matter.tsx', name: 'DoesNotMatter', args: {} } } } },
      },
    };
    const result = migrateCompositionDocumentV2ToV3(v2Doc, metadata);
    const diag = result.diagnostics.find(d => d.code === 'legacy-element-at-non-slot-path');
    assert.ok(diag, 'a real legacy-element-at-non-slot-path diagnostic is present');
    assert.equal(diag.severity, 'error');
    assert.equal('name' in result.document.root.props, false, 'the unconvertible prop was omitted entirely, not silently coerced into something invalid');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: migrateCompositionDocumentV2ToV3 - legacy "element" at a slot-domain path converts to a real nested instance', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const greeterMeta = byName(metadata, 'Greeter');
    const v2Doc = {
      schemaVersion: 2,
      root: {
        kind: 'instance',
        instanceId: 'n1',
        componentId: nestedMeta.id,
        props: {
          content: { kind: 'value', value: { type: 'object', value: { header: { type: 'object', value: { title: { type: 'string', value: 'T' }, subtitle: { type: 'string', value: 'S' } } } } } },
          sections: { kind: 'value', value: { type: 'array', value: [] } },
          // actions was stored (pre-repair) as a plain ValueJson array containing an "element" -
          // exactly the previously-unenforced-violation shape the repair closes.
          actions: {
            kind: 'value',
            value: { type: 'array', value: [{ type: 'element', value: { path: greeterMeta.sourcePath, name: 'Greeter', args: { name: { type: 'string', value: 'Migrated' } } } }] },
          },
        },
      },
    };
    const result = migrateCompositionDocumentV2ToV3(v2Doc, metadata);
    assert.deepEqual(result.diagnostics, [], 'a real slot-domain element reference converts losslessly, no discard needed');

    const actionsValue = result.document.root.props.actions.value;
    assert.equal(actionsValue.kind, 'array');
    assert.equal(actionsValue.items.length, 1);
    const entry = actionsValue.items[0].value;
    assert.equal(entry.kind, 'nodes');
    assert.equal(entry.value.items.length, 1);
    const item = entry.value.items[0];
    assert.equal(item.kind, 'instance');
    assert.equal(item.instance.componentId, greeterMeta.id);
    assert.deepEqual(item.instance.props.name, { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'Migrated' } } });

    const validation = validateComposition(result.document, metadata, registry);
    assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));

    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(renderComposition(result.document, metadata, registry));
    assert.match(html, /Hello, Migrated!/, 'the migrated element reference renders as a real nested Greeter instance');
  } finally {
    cleanFixtureOutput();
  }
});

// Folded in from the now-retired tests/runtime-v2.test.cjs (fully superseded by this file's
// coverage above, except for these two cases, which are genuinely unique and kept here).

test('runtime v3: stable itemId survives a reorder of CompositionArrayItem entries', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const nestedMeta = byName(metadata, 'NestedSlotCard');
    const greeterMeta = byName(metadata, 'Greeter');

    function makeDoc(items) {
      return {
        schemaVersion: 3,
        root: {
          kind: 'instance',
          instanceId: 'root',
          componentId: nestedMeta.id,
          props: {
            content: { kind: 'composed', value: { kind: 'object', fields: { header: { kind: 'object', fields: {
              title: { kind: 'richText', value: { kind: 'richText', version: 1, inline: true, nodes: [{ type: 'text', text: 'T', marks: [] }] } },
              subtitle: { kind: 'leaf', value: { type: 'string', value: 'S' } },
            } } } } },
            sections: { kind: 'composed', value: { kind: 'array', items: [] } },
            actions: { kind: 'composed', value: { kind: 'array', items } },
          },
        },
      };
    }

    const itemA = { itemId: 'entry-A', value: { kind: 'nodes', value: { items: [
      { itemId: 'a-node', kind: 'instance', instance: { kind: 'instance', instanceId: 'inst-A', componentId: greeterMeta.id, props: { name: { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'A' } } } } } },
    ] } } };
    const itemB = { itemId: 'entry-B', value: { kind: 'nodes', value: { items: [{ itemId: 'b-node', kind: 'text', value: 'B text' }] } } };

    const before = makeDoc([itemA, itemB]);
    assert.equal(validateComposition(before, metadata, registry).valid, true);

    // Reorder: a drag-and-drop move is a pure array splice, at the CompositionArrayItem level.
    const after = makeDoc([itemB, itemA]);
    const afterValidation = validateComposition(after, metadata, registry);
    assert.equal(afterValidation.valid, true, JSON.stringify(afterValidation.diagnostics));

    const foundA = after.root.props.actions.value.items.find(i => i.itemId === 'entry-A');
    const foundB = after.root.props.actions.value.items.find(i => i.itemId === 'entry-B');
    assert.ok(foundA, 'entry-A itemId survived the reorder');
    assert.equal(foundA.value.value.items[0].instance.instanceId, 'inst-A', 'the nested instanceId inside the moved entry also survived');
    assert.ok(foundB && foundB.value.value.items[0].value === 'B text');
    assert.equal(after.root.props.actions.value.items[0].itemId, 'entry-B', 'the array itself is genuinely reordered (position 0 changed)');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime v3: the full v1 -> v2 -> v3 migration chain renders equivalently to v1', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const cardMeta = byName(metadata, 'Card');
    const greeterMeta = byName(metadata, 'Greeter');

    const v1Doc = {
      schemaVersion: 1,
      root: {
        kind: 'instance',
        id: cardMeta.id,
        props: { title: { kind: 'value', value: { type: 'string', value: 'Chained' } } },
        children: [
          { kind: 'instance', id: greeterMeta.id, props: {
            name: { kind: 'value', value: { type: 'string', value: 'Chained Host' } },
            times: { kind: 'value', value: { type: 'number', value: 1 } },
          } },
        ],
      },
    };

    const v2 = migrateCompositionDocumentV1ToV2(v1Doc);
    assert.equal(v2.schemaVersion, 2);
    const v3Result = migrateCompositionDocumentV2ToV3(v2, metadata);
    assert.equal(v3Result.document.schemaVersion, 3);
    assert.deepEqual(v3Result.diagnostics, [], 'a document with no slot-domain content anywhere migrates losslessly through both steps');

    const validation = validateComposition(v3Result.document, metadata, registry);
    assert.deepEqual(validation.diagnostics, [], 'the fully-chained v3 document validates with zero diagnostics');

    const { renderToStaticMarkup } = require('react-dom/server');
    const html = renderToStaticMarkup(renderComposition(v3Result.document, metadata, registry));
    assert.match(html, /<section data-testid="card">/);
    assert.match(html, /<h2>Chained<\/h2>/);
    assert.match(html, /Hello, Chained Host!/, 'a document migrated through the full v1->v2->v3 chain renders the same content v1\'s own renderer would have');
  } finally {
    cleanFixtureOutput();
  }
});
