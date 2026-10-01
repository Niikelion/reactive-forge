// Composition-to-TSX export (gate E, extended for slots - phase 3 of the slot-contract work,
// docs/slot-contract.md section 9). Reuses the same real-bundle-plus-metadata pipeline
// tests/runtime-v2.test.cjs already proves for the v2 runtime (`forge codegen` then `forge bundle`
// against tests/fixtures/bundle-project/, via this file's own forge.export.config.ts/out-export to
// avoid racing other test files' output directories), then drives @reactive-forge/runtime's
// exportToTsx (packages/runtime/src/export.ts) against the real generated metadata.json.
//
// "Compiles": the generated TSX is written to a real file and fed through the real TypeScript
// compiler (ts.createProgram + getPreEmitDiagnostics, against the fixture project's own
// tsconfig.json compiler options) - a genuine typecheck.
//
// "Renders equivalent output": the exported TSX is required through the same
// tests/source-loader.cjs TS-to-CommonJS hook every other test file in this suite already relies
// on, rendered with react-dom/server's renderToStaticMarkup, and diffed byte-for-byte against the
// same composition document rendered through the already-proven @reactive-forge/runtime's
// renderComposition against the real bundle.js registry.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const fixtureProject = path.join(root, 'tests', 'fixtures', 'bundle-project');
const fixtureOutDir = path.join(fixtureProject, 'out-export');
const scratchDir = path.join(fixtureOutDir, 'exported');

const { validateComposition, renderComposition, exportToTsx, CompositionValidationError } = require(path.join(root, 'packages', 'runtime', 'src', 'index.ts'));

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
  assert.equal(path.basename(target), 'out-export', "Cleanup must target this file's own out-export directory");
  fs.rmSync(target, { recursive: true, force: true });
}

function byName(metadata, name) {
  const found = metadata.components.find(c => c.name === name);
  assert.ok(found, `expected component ${name} in metadata.json`);
  return found;
}

function richValue(metadata, text, id, italicText) {
  const props = {text: {kind: 'composed', value: {kind: 'leaf', value: {type: 'string', value: text}}}};
  if (italicText) props.italicText = {kind: 'composed', value: {kind: 'leaf', value: {type: 'string', value: italicText}}};
  return {kind: 'nodes', value: {items: [{itemId: `${id}-item`, kind: 'instance', instance: {
    kind: 'instance', instanceId: id, componentId: byName(metadata, 'RichContent').id, props
  }}]}};
}

async function buildFixture() {
  cleanFixtureOutput();
  const codegenResult = runCli(['codegen', '--config', 'forge.export.config.ts'], fixtureProject);
  assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
  const bundleResult = runCli(['bundle', '--config', 'forge.export.config.ts'], fixtureProject);
  assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

  const bundlePath = path.join(fixtureOutDir, 'bundle.js');
  const metadataPath = path.join(fixtureOutDir, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const registry = (await import(pathToFileURL(bundlePath).href)).components;
  assert.equal(metadata.schemaVersion, 4, 'group constraints use metadata schemaVersion 4');
  const richEntry = registry.files.flatMap(file => Object.values(file.components)).find(entry => entry.id === byName(metadata, 'RichContent').id);
  assert.ok(richEntry.groups.some(group => group.id === 'forge/RichText'), 'generated registration preserves host-declared membership');
  return { metadata, registry };
}

function compileTsx(filePaths) {
  const fixtureTsconfig = JSON.parse(fs.readFileSync(path.join(fixtureProject, 'tsconfig.json'), 'utf8'));
  const { options: compilerOptions, errors: optionErrors } = ts.convertCompilerOptionsFromJson(fixtureTsconfig.compilerOptions, scratchDir);
  assert.deepEqual(optionErrors, [], 'tsconfig.json compiler options parse cleanly');
  const program = ts.createProgram(filePaths, compilerOptions);
  const normalizedTargets = new Set(filePaths.map(p => p.replace(/\\/g, '/')));
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.file && normalizedTargets.has(d.file.fileName));
  if (diagnostics.length > 0) {
    const formatted = diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
    assert.fail(`Generated TSX failed to typecheck:\n${formatted}`);
  }
}

function scratchRelativeResolver() {
  return (component) => {
    const absoluteSource = path.resolve(fixtureProject, component.sourcePath);
    const withoutExtension = absoluteSource.replace(/\.(tsx?|jsx?)$/i, '');
    const relative = path.relative(scratchDir, withoutExtension).replace(/\\/g, '/');
    return relative.startsWith('.') ? relative : `./${relative}`;
  };
}

test('exportToTsx produces TSX that compiles and renders output identical to the runtime (value/callback/nested-instance coverage)', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const cardMeta = byName(metadata, 'Card');
    const greeterMeta = byName(metadata, 'Greeter');
    const showcaseMeta = byName(metadata, 'ExportShowcase');

    // v3 shape: "children" is an ordinary "nodes" prop, wrapped like every other non-callback prop
    // in {kind:"composed", value: CompositionValue} - holding a text item, a nested Greeter
    // instance, a void item, and a nested ExportShowcase instance, covering one prop of every
    // remaining ValueJson kind (string, number, boolean, array, object, date, bigint) as a
    // {kind:"leaf", ...} CompositionValue, plus two callback references.
    const doc = {
      schemaVersion: 5,
      props: {
        onCardRender: {schema: cardMeta.props.onRender.schema, required: true, typeSource: {componentId: cardMeta.id, propName: 'onRender'}},
        onShowcaseActivate: {schema: showcaseMeta.props.onActivate.schema, required: true, typeSource: {componentId: showcaseMeta.id, propName: 'onActivate'}},
        heading: {schema: {type: 'string'}, required: true, defaultValue: {type: 'string', value: 'Export Proof'}},
        unused: {schema: {type: 'number'}, required: false},
      },
      root: {
        kind: 'instance',
        instanceId: 'root-card',
        componentId: cardMeta.id,
        props: {
          title: {kind: 'prop', name: 'heading'},
          onRender: { kind: 'prop', name: 'onCardRender' },
          children: {
            kind: 'composed',
            value: {
              kind: 'nodes',
              value: {
                items: [
                  { itemId: 'intro', kind: 'text', value: 'Intro: ' },
                  {
                    itemId: 'greeter-item', kind: 'instance', instance: {
                      kind: 'instance', instanceId: 'greeter-1', componentId: greeterMeta.id,
                      props: {
                        name: { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'Exported Host' } } },
                        times: { kind: 'composed', value: { kind: 'leaf', value: { type: 'number', value: 2 } } },
                      },
                    },
                  },
                  { itemId: 'void-item', kind: 'void' },
                  {
                    itemId: 'showcase-item', kind: 'instance', instance: {
                      kind: 'instance', instanceId: 'showcase-1', componentId: showcaseMeta.id,
                      props: {
                        title: { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'Showcase' } } },
                        count: { kind: 'composed', value: { kind: 'leaf', value: { type: 'number', value: 7 } } },
                        active: { kind: 'composed', value: { kind: 'leaf', value: { type: 'boolean', value: true } } },
                        tags: { kind: 'composed', value: { kind: 'leaf', value: { type: 'array', value: [
                          { type: 'string', value: 'a' },
                          { type: 'string', value: 'b' },
                        ] } } },
                        meta: { kind: 'composed', value: { kind: 'leaf', value: { type: 'object', value: {
                          source: { type: 'string', value: 'fixture' },
                        } } } },
                        when: { kind: 'composed', value: { kind: 'leaf', value: { type: 'date', value: '2024-01-01T00:00:00.000Z' } } },
                        big: { kind: 'composed', value: { kind: 'leaf', value: { type: 'bigint', value: '123456789012345' } } },
                        onActivate: { kind: 'prop', name: 'onShowcaseActivate' },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };

    const validation = validateComposition(doc, metadata, registry, { onCardRender: () => {}, onShowcaseActivate: () => {} });
    assert.deepEqual(validation.diagnostics, [], 'the export fixture document validates with zero diagnostics');
    assert.equal(validation.valid, true);

    const { renderToStaticMarkup } = require('react-dom/server');
    const { createElement } = require('react');

    const runtimeCalls = [];
    const runtimeCallbacks = {
      onCardRender: () => runtimeCalls.push('card'),
      onShowcaseActivate: () => runtimeCalls.push('showcase'),
    };
    const runtimeElement = renderComposition(doc, metadata, registry, { props: runtimeCallbacks });
    const runtimeHtml = renderToStaticMarkup(runtimeElement);
    assert.deepEqual(runtimeCalls, ['card', 'showcase'], 'both callback references fired during the runtime render');

    fs.mkdirSync(scratchDir, { recursive: true });
    const exportedFilePath = path.join(scratchDir, 'ExportedComposition.tsx');
    const tsxSource = exportToTsx(doc, metadata, registry, { resolveImportPath: scratchRelativeResolver() });

    assert.match(tsxSource, /^import \{ Card } from/m, 'imports the Card component');
    assert.match(tsxSource, /^import \{ ExportShowcase } from/m, 'imports the ExportShowcase component');
    assert.match(tsxSource, /^import \{ Greeter } from/m, 'imports the Greeter component');
    assert.match(tsxSource, /export default function ExportedComposition/, 'exports the default composition component');
    assert.match(tsxSource, /title=\{values\["heading"\]\}/, 'explicit string binding is read from the public props');
    assert.match(tsxSource, /"unused"\?: number/, 'unused explicitly declared props remain public');
    assert.match(tsxSource, /times=\{2\}/, 'a number value serializes as a numeric literal expression');
    assert.match(tsxSource, /active=\{true\}/, 'a boolean value serializes as a literal expression');
    assert.match(tsxSource, /tags=\{\["a", "b"\]\}/, 'an array value serializes as an array-literal expression');
    assert.match(tsxSource, /meta=\{\{source: "fixture"\}\}/, 'an object value serializes as an object-literal expression');
    assert.match(tsxSource, /when=\{new Date\("2024-01-01T00:00:00\.000Z"\)\}/, 'a date value serializes as a `new Date(...)` expression');
    assert.match(tsxSource, /big=\{123456789012345n\}/, 'a bigint value serializes as a bigint literal expression');
    assert.match(tsxSource, /onRender=\{values\["onCardRender"\]\}/);
    assert.match(tsxSource, /onActivate=\{values\["onShowcaseActivate"\]\}/);
    assert.doesNotMatch(tsxSource, /callbacks|Record<string|\bany\b/);
    assert.doesNotMatch(tsxSource, /=>\s*\{/, 'no fabricated function body is ever emitted for a callback reference');
    assert.doesNotMatch(tsxSource, /\bchildren=/, 'children never emits as a JSX attribute');
    assert.match(tsxSource, /<Card[^>]*>\{"Intro: "\}<Greeter[^]*?\{null\}<ExportShowcase/, 'children renders directly inside Card in its original order');
    assert.match(tsxSource, /<\/Card>/, 'Card has a closing tag');
    fs.writeFileSync(exportedFilePath, tsxSource, 'utf8');

    compileTsx([exportedFilePath]);

    const exportedModule = require(exportedFilePath);
    const exportedComponent = exportedModule.default;
    assert.equal(typeof exportedComponent, 'function', 'the exported file has a default-exported component function');

    const exportedCalls = [];
    const exportedCallbacks = {
      onCardRender: () => exportedCalls.push('card'),
      onShowcaseActivate: () => exportedCalls.push('showcase'),
    };
    const exportedHtml = renderToStaticMarkup(createElement(exportedComponent, exportedCallbacks));
    assert.deepEqual(exportedCalls, ['card', 'showcase'], 'both callback references fired during the exported-component render, resolved through the supplied host callbacks object, never a stored function body');

    assert.equal(exportedHtml, runtimeHtml, 'the exported TSX renders byte-identical HTML to @reactive-forge/runtime\'s renderComposition for the same document');

    for (const [index, bindingName] of ['Card', 'ExportedComposition', 'default', 'save-click', 'callbacks'].entries()) {
      const candidate = structuredClone(doc);
      candidate.props = {...doc.props, [bindingName]: doc.props.onCardRender};
      delete candidate.props.onCardRender;
      delete candidate.props.onShowcaseActivate;
      candidate.root.props.onRender.name = bindingName;
      candidate.root.props.children.value.value.items[3].instance.props.onActivate.name = bindingName;
      const source = exportToTsx(candidate, metadata, registry, {resolveImportPath: scratchRelativeResolver()});
      const file = path.join(scratchDir, `Shared-${index}.tsx`);
      fs.writeFileSync(file, source);
      compileTsx([file]);
      let calls = 0;
      const html = renderToStaticMarkup(createElement(require(file).default, {[bindingName]: () => { calls++; }}));
      assert.equal(calls, 2, `explicit ${bindingName} declaration is shared by both handlers`);
      assert.equal(html, runtimeHtml);
    }
    const renamedSource = exportToTsx(doc, metadata, registry, {resolveImportPath: scratchRelativeResolver(), exportedComponentName: 'Card'});
    const renamedFile = path.join(scratchDir, 'Renamed.tsx');
    fs.writeFileSync(renamedFile, renamedSource);
    compileTsx([renamedFile]);
    assert.equal(renderToStaticMarkup(createElement(require(renamedFile).default, exportedCallbacks)), runtimeHtml);
    assert.equal(renderToStaticMarkup(createElement(exportedComponent, {...exportedCallbacks, heading: 'Different'})),
      renderToStaticMarkup(renderComposition(doc, metadata, registry, {props: {...runtimeCallbacks, heading: 'Different'}})),
      'explicit public values override declaration defaults equally in generated TSX and runtime');
    const legacy = structuredClone(doc);
    legacy.root.props.onRender = {kind: 'callback', name: 'legacy'};
    assert.throws(() => exportToTsx(legacy, metadata, registry), /explicitly declared function prop/,
      'legacy callback registry cannot create an implicit public input');
    const undeclared = structuredClone(doc);
    delete undeclared.props.onCardRender;
    assert.throws(() => exportToTsx(undeclared, metadata, registry), CompositionValidationError,
      'binding names never synthesize undeclared props');

    // Explicit empty children remain present; absent children remain absent.
    // Text stays an expression so JSX markup, entities and whitespace are preserved.
    const childCases = [
      ['absent', undefined],
      ['empty', {kind: 'nodes', value: {items: []}}],
      ['text', {kind: 'nodes', value: {items: [{kind: 'text', itemId: 'escaped-child', value: ' <tag>&amp; {value} "quoted"\n tail '} ]}}],
      ['instance', {kind: 'nodes', value: {items: [doc.root.props.children.value.value.items[1]]}}],
    ];
    for (const [name, children] of childCases) {
      const props = {title: {kind: 'composed', value: {kind: 'leaf', value: {type: 'string', value: 'Export Proof'}}}};
      if (children !== undefined) props.children = {kind: 'composed', value: children};
      const candidate = {...doc, props: {}, root: {...doc.root, props}};
      const source = exportToTsx(candidate, metadata, registry, {resolveImportPath: scratchRelativeResolver()});
      assert.doesNotMatch(source, /\bchildren=/);
      assert.match(source, /export default function ExportedComposition\(\)/, 'no declarations means zero public inputs');
      if (children === undefined) assert.match(source, /<Card title="Export Proof" \/>/);
      else assert.match(source, /<Card title="Export Proof">[^]*<\/Card>/);
      if (name === 'empty') assert.match(source, /<Card title="Export Proof"><\/Card>/);
      if (name === 'instance') assert.match(source, /<Card title="Export Proof"><Greeter/);
      assert.doesNotMatch(source, /<>|<\/>/, 'children do not add a Fragment wrapper');
      const file = path.join(scratchDir, `Children-${name}.tsx`);
      fs.writeFileSync(file, source);
      compileTsx([file]);
      const Component = require(file).default;
      assert.equal(renderToStaticMarkup(createElement(Component)),
        renderToStaticMarkup(renderComposition(candidate, metadata, registry)), `${name} children preserve rendered output`);
    }
  } finally {
    cleanFixtureOutput();
  }
});

test('exportToTsx serializes "nodes"/"richText"/"componentRef" slot values identically to renderComposition (SlotCard + RichTextShowcase)', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const slotIconMeta = byName(metadata, 'SlotIcon');
    const greeterMeta = byName(metadata, 'Greeter');
    const richTextShowcaseMeta = byName(metadata, 'RichTextShowcase');

    const doc = {
      schemaVersion: 3,
      root: {
        kind: 'instance',
        instanceId: 'root-slotcard',
        componentId: slotCardMeta.id,
        props: {
          // Unannotated ReactNode (no explicit rule) - the synthesized AnyNodePolicy default has
          // `multiple: true`, so even this single-item slot is Fragment-wrapped.
          header: { kind: 'composed', value: { kind: 'nodes', value: { items: [{ itemId: 'h1', kind: 'text', value: 'Header text' }] } } },
          // "actions": ReactNode[] is a DECLARED ARRAY (collection maxItems: 3, each() maxItems: 1
          // per entry) - per docs/slot-contract-recursive.md section 1.3, this is "array"-kind at
          // the top with 2 independent CompositionArrayItem entries, each entry's OWN value
          // directly "nodes"-kind (no intervening object, since each() lands straight on
          // ReactNode) - NOT a single flat "nodes" value the way v2 represented the whole prop.
          actions: {
            kind: 'composed',
            value: {
              kind: 'array',
              items: [
                {
                  itemId: 'a1',
                  value: { kind: 'nodes', value: { items: [
                    { itemId: 'a1-node', kind: 'instance', instance: { kind: 'instance', instanceId: 'greeter-action', componentId: greeterMeta.id, props: { name: { kind: 'composed', value: { kind: 'leaf', value: { type: 'string', value: 'Action Greeter' } } } } } },
                  ] } },
                },
                {
                  itemId: 'a2',
                  value: { kind: 'nodes', value: { items: [{ itemId: 'a2-node', kind: 'text', value: 'Second action' }] } },
                },
              ],
            },
          },
          // componentRef: a bare identifier expression, resolved through the registry the same way
          // render.ts's resolveComponentRef does - never JSX-wrapped, never called.
          icon: { kind: 'composed', value: { kind: 'componentRef', value: { source: 'project', id: slotIconMeta.id } } },
          // richText, matching SlotCard's own real policy (marks: ["bold"] only, blocks.lists: false).
          caption: {
            kind: 'composed',
            value: {
              ...richValue(metadata, 'Bold caption', 'caption-rich'),
            },
          },
          // "children" - an ordinary "nodes" prop like any other (no special sibling field), here
          // holding a nested RichTextShowcase instance whose own richText prop covers BOTH bold and
          // italic marks together, plus both paragraph and list blocks.
          children: {
            kind: 'composed',
            value: {
              kind: 'nodes',
              value: {
                items: [
                  {
                    itemId: 'c1', kind: 'instance', instance: {
                      kind: 'instance', instanceId: 'richtext-1', componentId: richTextShowcaseMeta.id,
                      props: {
                        body: {
                          kind: 'composed',
                          value: {
                            ...richValue(metadata, 'Bold text', 'body-rich', 'Italic item'),
                          },
                        },
                        // A bare ReactNode "nodes" slot with an EXPLICIT rule (`{kind: "any",
                        // maxItems: 1}`, no `multiple` key) and exactly one item - the single-item,
                        // non-multiple case that stays bare (no Fragment), unlike "header"'s
                        // unannotated (multiple:true-by-default) single item above.
                        footer: { kind: 'composed', value: { kind: 'nodes', value: { items: [{ itemId: 'f1', kind: 'text', value: 'Footer text' }] } } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };

    const validation = validateComposition(doc, metadata, registry);
    assert.deepEqual(validation.diagnostics, [], 'the slot-export fixture document validates with zero diagnostics');
    assert.equal(validation.valid, true);

    const { renderToStaticMarkup } = require('react-dom/server');
    const { createElement } = require('react');

    const runtimeElement = renderComposition(doc, metadata, registry);
    const runtimeHtml = renderToStaticMarkup(runtimeElement);

    fs.mkdirSync(scratchDir, { recursive: true });
    const exportedFilePath = path.join(scratchDir, 'ExportedSlotComposition.tsx');
    const tsxSource = exportToTsx(doc, metadata, registry, {
      exportedComponentName: 'ExportedSlotComposition',
      resolveImportPath: scratchRelativeResolver(),
    });

    assert.match(tsxSource, /^import \{ SlotCard } from/m, 'imports SlotCard');
    assert.match(tsxSource, /^import \{ SlotIcon } from/m, 'imports SlotIcon (the componentRef target)');
    assert.match(tsxSource, /^import \{ Greeter } from/m, 'imports the nested Greeter instance');
    assert.match(tsxSource, /^import \{ RichTextShowcase } from/m, 'imports RichTextShowcase');

    // "nodes": an unannotated (multiple:true-by-default) single-item slot still wraps in a Fragment.
    assert.match(tsxSource, /header=\{<>\{"Header text"\}<\/>\}/, 'a single-item unannotated ReactNode slot is Fragment-wrapped (multiple:true synthesized default)');
    // "nodes" reached through a DECLARED ARRAY prop (`actions: ReactNode[]`) serializes as a real
    // array literal, not a Fragment - nested instance then text, in order (see
    // serializeSlotArrayExpression's doc comment in export.ts for why this differs from a bare
    // ReactNode slot's Fragment-wrapping rule).
    assert.match(tsxSource, /actions=\{\[<Greeter name="Action Greeter" \/>, "Second action"\]\}/, 'the "actions" declared-array slot serializes its nested instance and text item in order as an array literal');
    // "componentRef": a bare identifier, never JSX-wrapped, never called.
    assert.match(tsxSource, /icon=\{SlotIcon\}/, 'componentRef emits a bare identifier expression, not JSX and not a call');
    assert.doesNotMatch(tsxSource, /icon=\{<SlotIcon/, 'componentRef is never JSX-wrapped');
    // "richText": the same fixed <p>/<strong> mapping render.ts produces.
    assert.match(tsxSource, /caption=\{<RichContent/, 'rich content exports as a host component');
    // "richText" with both bold+italic marks and both paragraph/list blocks, nested under "children".
    assert.match(tsxSource, /italicText="Italic item"/, 'host component props export unchanged');
    // "nodes": a single item under an EXPLICITLY-authored rule that does not itself restate
    // `multiple` (RichTextShowcase's `footer` rule is `{kind: "any", maxItems: 1}`, no `multiple`
    // key) stays BARE - no Fragment - mirroring render.ts's precise `"multiple" in slot` check
    // (which looks at whether the key is literally present, not at AnyNodePolicy's own "default
    // true" semantics for an unruled path). This is the single-item non-multiple case
    // docs/slot-contract.md section 9 calls out explicitly ("get this precise") - distinct from
    // "header" above, whose single item IS Fragment-wrapped because it is genuinely unannotated.
    assert.match(tsxSource, /footer=\{"Footer text"\}/, 'a single-item slot under an explicit non-multiple-keyed rule stays bare, unwrapped');
    assert.doesNotMatch(tsxSource, /footer=\{<>/, 'no Fragment is emitted for this single-item, non-multiple slot');
    fs.writeFileSync(exportedFilePath, tsxSource, 'utf8');

    compileTsx([exportedFilePath]);

    const exportedModule = require(exportedFilePath);
    const exportedComponent = exportedModule.default;
    const exportedHtml = renderToStaticMarkup(createElement(exportedComponent));

    assert.equal(exportedHtml, runtimeHtml, 'the exported TSX renders byte-identical HTML to renderComposition for a document exercising "nodes"/"richText"/"componentRef"');
  } finally {
    cleanFixtureOutput();
  }
});

test('exportToTsx refuses an invalid document instead of silently serializing it (Codex repair finding #4)', async () => {
  const { metadata, registry } = await buildFixture();
  try {
    const slotCardMeta = byName(metadata, 'SlotCard');
    const greeterMeta = byName(metadata, 'Greeter');

    // SlotCard.icon's real, colocated slot rule only accepts SlotIcon (see
    // tests/fixtures/bundle-project/src/components/SlotCard.tsx) - pointing it at Greeter instead
    // is a real, genuine policy violation, not a hand-rolled edge case.
    const invalidDoc = {
      schemaVersion: 3,
      root: {
        kind: 'instance',
        instanceId: 'root-invalid',
        componentId: slotCardMeta.id,
        props: {
          header: { kind: 'composed', value: { kind: 'nodes', value: { items: [] } } },
          actions: { kind: 'composed', value: { kind: 'nodes', value: { items: [] } } },
          icon: { kind: 'composed', value: { kind: 'componentRef', value: { source: 'project', id: greeterMeta.id } } },
          caption: { kind: 'composed', value: {kind: 'nodes', value: {items: []}} },
        },
      },
    };

    // Before the fix, exportToTsx never validated at all - it required no `library` parameter and
    // would happily serialize `icon={Greeter}` into TSX text, even though that value violates
    // SlotCard's own real, colocated policy.
    const preValidation = validateComposition(invalidDoc, metadata, registry);
    assert.equal(preValidation.valid, false, 'sanity check: this document really is invalid against the real SlotCard policy');
    assert.ok(preValidation.diagnostics.some(d => d.code === 'component-not-accepted'), 'the real rejection reason is Greeter not being in icon\'s accepts list');

    assert.throws(
      () => exportToTsx(invalidDoc, metadata, registry),
      (err) => {
        assert.ok(err instanceof CompositionValidationError, 'exportToTsx throws the SAME CompositionValidationError type renderComposition throws, not a parallel error shape');
        assert.ok(err.diagnostics.some(d => d.code === 'component-not-accepted'), 'the thrown error carries the real, actionable diagnostic');
        return true;
      },
      'exportToTsx refuses to serialize a document that violates a real slot policy'
    );
  } finally {
    cleanFixtureOutput();
  }
});
