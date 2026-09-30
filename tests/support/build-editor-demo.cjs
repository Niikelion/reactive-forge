// Dev-only build helper for the interactive composition-editor demo
// (tests/fixtures/editor-demo/). Mirrors tests/support/static-server.cjs's
// "dev-only manual-verification helper" status: not part of `yarn build`,
// not a product build step.
//
// Why this exists: @reactive-forge/editor and @reactive-forge/runtime's
// published dist/ output leaves @reactive-forge/schema and react as external
// bare-specifier imports (workspace dependencies - see e.g.
// packages/editor/package.json's "dependencies" - tsdown does not bundle
// them in). A plain browser `<script type="module">` cannot resolve a bare
// specifier without either an import map entry per package or a bundling
// pass. There is no reason a demo host needs @reactive-forge/editor/
// runtime/schema as separate import-mapped peers the way it needs react
// (which tests/fixtures/independent-host/index.html already supplies via a
// CDN import map) - so this bundles the demo entry point together with all
// three of those packages into one browser ESM file, and marks external
// ONLY the exact same `hostProvidedPeers` list packages/codegen/src/bundle.ts
// uses for the component-registry bundle. Keeping that list identical (not
// independently re-derived) is what lets both bundles share a single import
// map with no duplicate React instance loaded (see
// tests/fixtures/editor-demo/index.html).
//
// Build path: esbuild's own JS API, called directly - same choice
// packages/codegen/src/bundle.ts already made and documented (esbuild is
// already a hard runtime dependency of this workspace, via `load-config-ts`
// -> `bundle-require`, see docs/baseline.md's "esbuild/load-config-ts
// dependency gap" note). No plugin framework.
const esbuild = require("esbuild");
const path = require("node:path");

// Must match packages/codegen/src/bundle.ts's `hostProvidedPeers` exactly -
// these are the specifiers tests/fixtures/editor-demo/index.html's import
// map (and tests/fixtures/independent-host/index.html's, for the sibling
// gate-C fixture) resolves via a CDN. Everything else the demo entry point
// imports (@reactive-forge/editor, @reactive-forge/runtime,
// @reactive-forge/schema, and any relative helper files) is bundled in.
const hostProvidedPeers = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
];

/**
 * @param {{ entry: string, outfile: string }} options
 * @returns {Promise<string>} the absolute path of the written bundle file
 */
async function buildEditorDemo({ entry, outfile }) {
  const entryPath = path.resolve(entry);
  const outfilePath = path.resolve(outfile);

  await esbuild.build({
    entryPoints: [entryPath],
    outfile: outfilePath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    // Explicit, not left to esbuild's own tsconfig.json auto-discovery -
    // same rationale as bundle.ts: correctness should not depend on
    // whichever tsconfig.json esbuild happens to find first when walking up
    // from the entry point.
    jsx: "automatic",
    external: hostProvidedPeers,
    write: true,
    logLevel: "silent",
  });

  return outfilePath;
}

module.exports = { buildEditorDemo, hostProvidedPeers };

if (require.main === module) {
  const entry = process.argv[2] || path.join(__dirname, "..", "fixtures", "editor-demo", "demo.tsx");
  const outfile = process.argv[3] || path.join(__dirname, "..", "fixtures", "editor-demo", "demo.js");
  buildEditorDemo({ entry, outfile })
    .then((written) => { console.log(`Built editor demo bundle -> ${written}`); })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
