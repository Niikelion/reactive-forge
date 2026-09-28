// Gate E (docs/claude-handoff.md section E / docs/development-plan.md's
// architecture diagram's "later: React source export"): composition-to-TSX
// export. Proves the acceptance bar verbatim: "Composition-to-TSX export
// follows the supported document contract; exported code must compile and
// render equivalent output."
//
// Reuses the same real-bundle-plus-metadata pipeline tests/runtime.test.cjs
// and tests/editor.test.cjs already prove (`forge codegen` then
// `forge bundle` against tests/fixtures/bundle-project/, via its own
// forge.export.config.ts/out-export to avoid racing other test files'
// output directories - see forge.runtime.config.ts for the established
// rationale), then drives @reactive-forge/runtime's exportToTsx
// (packages/runtime/src/export.ts) against the real generated metadata.json.
//
// "Compiles": the generated TSX is written to a real file and fed through
// the real TypeScript compiler (ts.createProgram + getPreEmitDiagnostics,
// against the fixture project's own tsconfig.json compiler options) - a
// genuine typecheck, not transpileModule's syntax-only pass and not "looks
// right by inspection".
//
// "Renders equivalent output": the exported TSX is required through the
// same tests/source-loader.cjs TS-to-CommonJS hook every other test file in
// this suite already relies on (registered globally by scripts/test.cjs's
// `--require ./tests/source-loader.cjs`), rendered with react-dom/server's
// renderToStaticMarkup, and diffed byte-for-byte against the same
// composition document rendered through the already-proven
// @reactive-forge/runtime's renderComposition against the real bundle.js
// registry. Both paths use the same source components (the exported TSX
// imports directly from tests/fixtures/bundle-project/src/components/*.tsx;
// the registry path uses the bundled version of the same source), the same
// prop values, and the same callback registry, so byte-identical HTML - not
// just "equivalent modulo whitespace" - is the honest claim here.
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

const { validateComposition, renderComposition, exportToTsx } = require(path.join(root, 'packages', 'runtime', 'src', 'index.ts'));

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

test('exportToTsx produces TSX that compiles and renders output identical to the runtime', async () => {
  cleanFixtureOutput();
  try {
    const codegenResult = runCli(['codegen', '--config', 'forge.export.config.ts'], fixtureProject);
    assert.equal(codegenResult.status, 0, codegenResult.stdout + codegenResult.stderr);
    const bundleResult = runCli(['bundle', '--config', 'forge.export.config.ts'], fixtureProject);
    assert.equal(bundleResult.status, 0, bundleResult.stdout + bundleResult.stderr);

    const bundlePath = path.join(fixtureOutDir, 'bundle.js');
    const metadataPath = path.join(fixtureOutDir, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const registry = (await import(pathToFileURL(bundlePath).href)).components;

    const cardMeta = metadata.components.find(c => c.name === 'Card');
    const greeterMeta = metadata.components.find(c => c.name === 'Greeter');
    const showcaseMeta = metadata.components.find(c => c.name === 'ExportShowcase');
    assert.ok(cardMeta, 'metadata.json describes Card');
    assert.ok(greeterMeta, 'metadata.json describes Greeter');
    assert.ok(showcaseMeta, 'metadata.json describes ExportShowcase');

    // --- A composition document nesting Card > [text, Greeter, void,
    // ExportShowcase], covering one prop of every ValueJson kind the
    // exporter serializes (string, number, boolean, array, object, date,
    // bigint) plus two callback references and a text/void child. ---
    const doc = {
      schemaVersion: 1,
      root: {
        kind: 'instance',
        id: cardMeta.id,
        props: {
          title: { kind: 'value', value: { type: 'string', value: 'Export Proof' } },
          onRender: { kind: 'callback', name: 'onCardRender' },
        },
        children: [
          { kind: 'text', value: 'Intro: ' },
          {
            kind: 'instance',
            id: greeterMeta.id,
            props: {
              name: { kind: 'value', value: { type: 'string', value: 'Exported Host' } },
              times: { kind: 'value', value: { type: 'number', value: 2 } },
            },
          },
          { kind: 'void' },
          {
            kind: 'instance',
            id: showcaseMeta.id,
            props: {
              title: { kind: 'value', value: { type: 'string', value: 'Showcase' } },
              count: { kind: 'value', value: { type: 'number', value: 7 } },
              active: { kind: 'value', value: { type: 'boolean', value: true } },
              tags: { kind: 'value', value: { type: 'array', value: [
                { type: 'string', value: 'a' },
                { type: 'string', value: 'b' },
              ] } },
              meta: { kind: 'value', value: { type: 'object', value: {
                source: { type: 'string', value: 'fixture' },
              } } },
              when: { kind: 'value', value: { type: 'date', value: '2024-01-01T00:00:00.000Z' } },
              big: { kind: 'value', value: { type: 'bigint', value: '123456789012345' } },
              onActivate: { kind: 'callback', name: 'onShowcaseActivate' },
            },
          },
        ],
      },
    };

    const validation = validateComposition(doc, metadata, registry, { onCardRender: () => {}, onShowcaseActivate: () => {} });
    assert.deepEqual(validation.diagnostics, [], 'the export fixture document validates with zero diagnostics');
    assert.equal(validation.valid, true);

    const { renderToStaticMarkup } = require('react-dom/server');
    const { createElement } = require('react');

    // --- Path A: the already-proven runtime, against the real bundle.js registry. ---
    const runtimeCalls = [];
    const runtimeCallbacks = {
      onCardRender: () => runtimeCalls.push('card'),
      onShowcaseActivate: () => runtimeCalls.push('showcase'),
    };
    const runtimeElement = renderComposition(doc, metadata, registry, { callbacks: runtimeCallbacks });
    const runtimeHtml = renderToStaticMarkup(runtimeElement);
    assert.deepEqual(runtimeCalls, ['card', 'showcase'], 'both callback references fired during the runtime render');

    // --- exportToTsx: generate real TSX source text. ---
    fs.mkdirSync(scratchDir, { recursive: true });
    const exportedFilePath = path.join(scratchDir, 'ExportedComposition.tsx');
    const tsxSource = exportToTsx(doc, metadata, {
      // Places every import relative to `scratchDir`, since the exporter
      // itself has no knowledge of where its caller will write the file -
      // see ExportOptions.resolveImportPath's doc comment in export.ts.
      resolveImportPath: (component) => {
        const absoluteSource = path.resolve(fixtureProject, component.sourcePath);
        const withoutExtension = absoluteSource.replace(/\.(tsx?|jsx?)$/i, '');
        const relative = path.relative(scratchDir, withoutExtension).replace(/\\/g, '/');
        return relative.startsWith('.') ? relative : `./${relative}`;
      },
    });
    assert.match(tsxSource, /^import \{ Card } from/m, 'imports the Card component');
    assert.match(tsxSource, /^import \{ ExportShowcase } from/m, 'imports the ExportShowcase component');
    assert.match(tsxSource, /^import \{ Greeter } from/m, 'imports the Greeter component');
    assert.match(tsxSource, /export default function ExportedComposition/, 'exports the default composition component');
    assert.match(tsxSource, /title="Export Proof"/, 'a plain string value serializes as a bare JSX string attribute');
    assert.match(tsxSource, /times=\{2\}/, 'a number value serializes as a numeric literal expression');
    assert.match(tsxSource, /active=\{true\}/, 'a boolean value serializes as a literal expression');
    assert.match(tsxSource, /tags=\{\["a", "b"\]\}/, 'an array value serializes as an array-literal expression');
    assert.match(tsxSource, /meta=\{\{source: "fixture"\}\}/, 'an object value serializes as an object-literal expression');
    assert.match(tsxSource, /when=\{new Date\("2024-01-01T00:00:00\.000Z"\)\}/, 'a date value serializes as a `new Date(...)` expression');
    assert.match(tsxSource, /big=\{123456789012345n\}/, 'a bigint value serializes as a bigint literal expression');
    assert.match(tsxSource, /onRender=\{callbacks\.onCardRender\}/, 'a callback reference serializes as a callbacks.<name> property access, never a function body');
    assert.match(tsxSource, /onActivate=\{callbacks\.onShowcaseActivate\}/);
    assert.doesNotMatch(tsxSource, /=>\s*\{/, 'no fabricated function body is ever emitted for a callback reference');
    fs.writeFileSync(exportedFilePath, tsxSource, 'utf8');

    // --- "Compiles": a real TypeScript typecheck, not transpileModule's
    // syntax-only pass and not visual inspection. Uses the fixture
    // project's own tsconfig.json compiler options. ---
    const fixtureTsconfig = JSON.parse(fs.readFileSync(path.join(fixtureProject, 'tsconfig.json'), 'utf8'));
    const { options: compilerOptions, errors: optionErrors } = ts.convertCompilerOptionsFromJson(fixtureTsconfig.compilerOptions, scratchDir);
    assert.deepEqual(optionErrors, [], 'tsconfig.json compiler options parse cleanly');
    const program = ts.createProgram([exportedFilePath], compilerOptions);
    const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.file && d.file.fileName === exportedFilePath.replace(/\\/g, '/'));
    if (diagnostics.length > 0) {
      const formatted = diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
      assert.fail(`Generated TSX failed to typecheck:\n${formatted}`);
    }

    // --- "Renders equivalent output": require the real generated TSX file
    // (through the same TS-to-CommonJS hook every other test file in this
    // suite relies on - see scripts/test.cjs / tests/source-loader.cjs) and
    // render it with the same prop values and callback registry. ---
    const exportedModule = require(exportedFilePath);
    const exportedComponent = exportedModule.default;
    assert.equal(typeof exportedComponent, 'function', 'the exported file has a default-exported component function');

    const exportedCalls = [];
    const exportedCallbacks = {
      onCardRender: () => exportedCalls.push('card'),
      onShowcaseActivate: () => exportedCalls.push('showcase'),
    };
    const exportedHtml = renderToStaticMarkup(createElement(exportedComponent, { callbacks: exportedCallbacks }));
    assert.deepEqual(exportedCalls, ['card', 'showcase'], 'both callback references fired during the exported-component render, resolved through the supplied host callbacks object, never a stored function body');

    // --- The actual equivalence claim: byte-identical HTML. Both paths
    // render the exact same source components (the registry path via the
    // bundled build, the exported-TSX path via a direct import of the same
    // source files) with the exact same prop values, so nothing here is
    // "equivalent modulo whitespace" - it's the same output. ---
    assert.equal(exportedHtml, runtimeHtml, 'the exported TSX renders byte-identical HTML to @reactive-forge/runtime\'s renderComposition for the same document');
  } finally {
    cleanFixtureOutput();
  }
});
