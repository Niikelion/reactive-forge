// Independent host script. See index.html for the decoupling rationale.
//
// Everything this file touches about the fixture library comes from two
// artifacts: the standalone bundle and the portable metadata document. It
// never imports anything under tests/fixtures/bundle-project/src or
// packages/.
const outDir = "../bundle-project/out";

function report(status, detail) {
    // Exposed on `window` so an external harness (tests/bundle.test.cjs,
    // driven through the Browser pane) can read the outcome without scraping
    // console output.
    window.__rf_host_result = { status, detail };
}

// Also load the "bundle.css" sibling the asset-bearing Branded component
// needs (its @font-face + background-image rules) - a real host serving
// this bundle would need to do the same; nothing in bundle.js itself
// injects CSS, esbuild only emits the sibling file (see bundle.ts's
// cssFile handling).
function loadStylesheet(href) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
}

function findEntry(registryModule, id) {
    for (const file of registryModule.components.files) {
        for (const candidate of Object.values(file.components)) {
            if (candidate.id === id) return candidate;
        }
    }
    return undefined;
}

// A component using a "file"-loader asset directly (Branded.tsx's
// `import logo from "./logo.png"`) ends up with a plain string constant in
// the bundle - e.g. "./logo-E2YJMYXN.png", relative to bundle.js's own
// output directory (verified in tests/bundle.test.cjs). That's different
// from a CSS `url(...)` reference, which the browser resolves automatically
// relative to the *stylesheet's* URL - no host action needed there. A DOM
// attribute set from that plain string (e.g. this fixture's <img src=...>)
// instead resolves relative to the *document's* base URI, which is this
// host page's own URL, not the bundle's output directory - confirmed by a
// real 404 during development (GET .../independent-host/logo-*.png) before
// this fix. A real host must account for this itself; inserting a `<base>`
// element pointing at the bundle's own output directory (computed from
// `import.meta.url`, so it is correct regardless of where this host page is
// served from) is the fix used here. It only affects DOM-attribute-style
// relative URL resolution going forward (module import()/fetch() specifiers
// already resolve relative to the referencing module's URL, unaffected by
// `<base>` - see outDir usage above, unchanged).
function installAssetBase() {
    const base = document.createElement("base");
    base.href = new URL(`${outDir}/`, import.meta.url).href;
    document.head.appendChild(base);
}

async function main() {
    const registryModule = await import(/* @vite-ignore */ `${outDir}/bundle.js`);
    const metadataResponse = await fetch(`${outDir}/metadata.json`);
    if (!metadataResponse.ok) throw new Error(`Could not fetch metadata.json: ${String(metadataResponse.status)}`);
    const metadata = await metadataResponse.json();

    if (metadata.schemaVersion !== 1) throw new Error(`Unsupported metadata schemaVersion: ${String(metadata.schemaVersion)}`);

    loadStylesheet(`${outDir}/bundle.css`);

    // Pick a component by its stable metadata id, per the gate C acceptance
    // bar ("picks a component from the fixture library by its stable id").
    const target = metadata.components.find(c => c.name === "Greeter");
    if (target === undefined) throw new Error("Fixture component \"Greeter\" not found in metadata.json");
    const selectedId = target.id;

    // The generated registry's entries now carry the same stable `id` that
    // metadata.json uses (packages/codegen/src/hash.ts's `componentId`, used
    // both by generate.ts's registry entries and its metadata.json output),
    // so a host resolves a metadata id straight to a registry entry - no more
    // path/name heuristic matching (previously a documented known gap here).
    const entry = findEntry(registryModule, selectedId);
    if (entry === undefined) throw new Error(`No registry component with id "${selectedId}" (metadata name "${target.name}")`);

    // Asset-loader proof (docs/claude-handoff.md gate C: "renders components
    // with styles/assets", previously only styles were exercised here). The
    // "Branded" component imports a real image and a real CSS file with an
    // @font-face + background-image, both reaching the "file"-loader assets
    // packages/codegen/src/bundle.ts now configures - see bundle.test.cjs
    // for the equivalent Node-side proof of the same claim.
    const brandedTarget = metadata.components.find(c => c.name === "Branded");
    if (brandedTarget === undefined) throw new Error("Fixture component \"Branded\" not found in metadata.json");
    const brandedEntry = findEntry(registryModule, brandedTarget.id);
    if (brandedEntry === undefined) throw new Error(`No registry component with id "${brandedTarget.id}" (metadata name "Branded")`);

    installAssetBase();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    const root = createRoot(document.getElementById("root"));
    // Simple hardcoded prop values - proving the render path, not the editor.
    root.render(
        React.createElement(
            React.Fragment,
            null,
            React.createElement(entry.component, { name: "Independent Host", times: 2 }),
            React.createElement(brandedEntry.component, { label: "Independent Host Asset Proof" })
        )
    );

    report("ok", {
        selectedId,
        selectedName: target.name,
        sourcePath: target.sourcePath,
        brandedId: brandedTarget.id,
        brandedSourcePath: brandedTarget.sourcePath,
    });
}

main().catch(error => {
    console.error(error);
    report("error", String((error && error.stack) || error));
});
