// Gate D, part 1 (docs/claude-handoff.md section D): "a small runtime for
// validated composition documents, stable component lookup, nested
// elements/children, and save/reload."
//
// Reuses the exact real-bundle-plus-metadata pipeline tests/bundle.test.cjs
// already proves (`forge codegen` then `forge bundle` against
// tests/fixtures/bundle-project/), then drives @reactive-forge/runtime
// (packages/runtime/src) against the real, built bundle.js + metadata.json -
// not mocks - to prove: composition validation, nested rendering (Card
// wrapping Greeter as a child), a callback-reference prop resolved through a
// host registry, and JSON save/reload producing identical render output.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const fixtureProject = path.join(root, 'tests', 'fixtures', 'bundle-project');
// A distinct config + outDir from tests/bundle.test.cjs's ("./out"): node's
// test runner can run test files concurrently, and both files exercise the
// same fixture project's real CLI pipeline - sharing one outDir raced
// (observed: one file's cleanup deleting output the other had just
// generated). See forge.runtime.config.ts for the full rationale.
const fixtureOutDir = path.join(fixtureProject, 'out-runtime');

const { validateComposition, renderComposition, CompositionValidationError } = require(path.join(root, 'packages', 'runtime', 'src', 'index.ts'));

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
  assert.equal(path.basename(target), 'out-runtime', 'Cleanup must target this file\'s own out-runtime directory');
  fs.rmSync(target, { recursive: true, force: true });
}

test('runtime validates, renders, and round-trips a nested composition document against a real bundle + metadata', async () => {
  cleanFixtureOutput();
  try {
    const codegenResult = runCli(['codegen', '--config', 'forge.runtime.config.ts'], fixtureProject);
    assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
    const bundleResult = runCli(['bundle', '--config', 'forge.runtime.config.ts'], fixtureProject);
    assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

    const bundlePath = path.join(fixtureOutDir, 'bundle.js');
    const metadataPath = path.join(fixtureOutDir, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const registry = (await import(pathToFileURL(bundlePath).href)).components;

    const cardMeta = metadata.components.find(c => c.name === 'Card');
    const greeterMeta = metadata.components.find(c => c.name === 'Greeter');
    assert.ok(cardMeta, 'metadata.json describes Card');
    assert.ok(greeterMeta, 'metadata.json describes Greeter');

    // KNOWN GAP, out of this gate's file ownership (extract.ts is frozen for
    // this task): packages/codegen/src/extract.ts's typeToSchema has no case
    // that recognizes a function-typed prop and emits FunctionSchema - a
    // zero-arg callback prop like Card's `onRender` is currently extracted
    // as an (empty) object/undefined union instead. This is a real,
    // independently-reproducible extraction gap (verified: `node -e` dumping
    // metadata.json for this exact fixture shows
    // `{"type":"union","types":[{"type":"object","properties":{}},{"type":"undefined"}]}`
    // for `onRender`, not `{"type":"function",...}`), not something the
    // runtime package can or should paper over silently. Since fixing
    // extraction is out of scope here, this test patches only that one
    // field on the in-memory metadata copy to the FunctionSchema shape
    // extraction *should* produce, so the callback-reference mechanism
    // itself - the actual subject of this test - can be exercised against
    // real bundle/registry/id data for everything else.
    cardMeta.props.onRender.schema = { type: 'function', returnType: { type: 'unknown' }, paramsType: { type: 'array', tupleTypes: [] } };

    // --- Build a composition document: Card, nesting Greeter as a child,
    // with a callback-reference prop (not a stored function body). ---
    const doc = {
      schemaVersion: 1,
      root: {
        kind: 'instance',
        id: cardMeta.id,
        props: {
          title: { kind: 'value', value: { type: 'string', value: 'Greetings' } },
          onRender: { kind: 'callback', name: 'onCardRender' },
        },
        children: [
          {
            kind: 'instance',
            id: greeterMeta.id,
            props: {
              name: { kind: 'value', value: { type: 'string', value: 'Composed Host' } },
              times: { kind: 'value', value: { type: 'number', value: 2 } },
            },
          },
        ],
      },
    };

    const renderCalls = [];
    const callbacks = { onCardRender: () => renderCalls.push(true) };

    const validation = validateComposition(doc, metadata, registry, callbacks);
    assert.deepEqual(validation.diagnostics, [], 'a well-formed document validates with zero diagnostics');
    assert.equal(validation.valid, true);

    const { renderToStaticMarkup } = require('react-dom/server');

    const element = renderComposition(doc, metadata, registry, { callbacks });
    const html = renderToStaticMarkup(element);

    assert.equal(renderCalls.length, 1, 'the callback reference actually fired during render');
    assert.match(html, /<section data-testid="card">/);
    assert.match(html, /<h2>Greetings<\/h2>/);
    assert.match(html, /<div data-testid="card-body">.*<div data-testid="greeter">/);
    assert.match(html, /Hello, Composed Host!/);
    assert.equal((html.match(/Hello, Composed Host!/g) || []).length, 2, 'times: 2 rendered two greetings, nested inside the card');

    // --- Save/reload: plain JSON round trip must render identically. ---
    const reloaded = JSON.parse(JSON.stringify(doc));
    assert.deepEqual(reloaded, doc, 'composition document round-trips through JSON.stringify/JSON.parse with no loss');

    renderCalls.length = 0;
    const elementAfterReload = renderComposition(reloaded, metadata, registry, { callbacks });
    const htmlAfterReload = renderToStaticMarkup(elementAfterReload);
    assert.equal(htmlAfterReload, html, 'render output is identical before and after save/reload');
    assert.equal(renderCalls.length, 1, 'the callback still resolves and fires after reload');
  } finally {
    cleanFixtureOutput();
  }
});

test('runtime validation reports structured diagnostics instead of throwing for common mistakes', async () => {
  cleanFixtureOutput();
  try {
    const codegenResult = runCli(['codegen', '--config', 'forge.runtime.config.ts'], fixtureProject);
    assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
    const bundleResult = runCli(['bundle', '--config', 'forge.runtime.config.ts'], fixtureProject);
    assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

    const metadata = JSON.parse(fs.readFileSync(path.join(fixtureOutDir, 'metadata.json'), 'utf8'));
    const registry = (await import(pathToFileURL(path.join(fixtureOutDir, 'bundle.js')).href)).components;
    const greeterMeta = metadata.components.find(c => c.name === 'Greeter');

    // Unknown component id.
    const unknownIdDoc = { schemaVersion: 1, root: { kind: 'instance', id: 'does-not-exist', props: {} } };
    const unknownIdResult = validateComposition(unknownIdDoc, metadata, registry);
    assert.equal(unknownIdResult.valid, false);
    assert.ok(unknownIdResult.diagnostics.some(d => d.code === 'unknown-component-id'));

    // Missing required prop ("name" on Greeter).
    const missingPropDoc = { schemaVersion: 1, root: { kind: 'instance', id: greeterMeta.id, props: {} } };
    const missingPropResult = validateComposition(missingPropDoc, metadata, registry);
    assert.equal(missingPropResult.valid, false);
    assert.ok(missingPropResult.diagnostics.some(d => d.code === 'missing-required-prop' && d.path === 'root.props.name'));
    assert.throws(() => renderComposition(missingPropDoc, metadata, registry), CompositionValidationError);

    // Wrong-typed prop value.
    const badTypeDoc = { schemaVersion: 1, root: { kind: 'instance', id: greeterMeta.id, props: {
      name: { kind: 'value', value: { type: 'number', value: 5 } },
    } } };
    const badTypeResult = validateComposition(badTypeDoc, metadata, registry);
    assert.equal(badTypeResult.valid, false);
    assert.ok(badTypeResult.diagnostics.some(d => d.code === 'invalid-prop-value'));

    // Callback reference to a name absent from the host registry: not a
    // silent no-op, an explicit validation error. Patches Card's `onRender`
    // schema to FunctionSchema for the same reason as the test above
    // (extract.ts doesn't yet emit FunctionSchema for function-typed props -
    // see that test's comment).
    const cardMeta = metadata.components.find(c => c.name === 'Card');
    cardMeta.props.onRender.schema = { type: 'function', returnType: { type: 'unknown' }, paramsType: { type: 'array', tupleTypes: [] } };
    const missingCallbackDoc = { schemaVersion: 1, root: { kind: 'instance', id: cardMeta.id, props: {
      title: { kind: 'value', value: { type: 'string', value: 'X' } },
      onRender: { kind: 'callback', name: 'not_registered' },
    } } };
    const missingCallbackResult = validateComposition(missingCallbackDoc, metadata, registry, {});
    assert.equal(missingCallbackResult.valid, false);
    assert.ok(missingCallbackResult.diagnostics.some(d => d.code === 'unresolved-callback'));
  } finally {
    cleanFixtureOutput();
  }
});
