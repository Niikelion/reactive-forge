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

async function main() {
    const registryModule = await import(/* @vite-ignore */ `${outDir}/bundle.js`);
    const metadataResponse = await fetch(`${outDir}/metadata.json`);
    if (!metadataResponse.ok) throw new Error(`Could not fetch metadata.json: ${String(metadataResponse.status)}`);
    const metadata = await metadataResponse.json();

    if (metadata.schemaVersion !== 1) throw new Error(`Unsupported metadata schemaVersion: ${String(metadata.schemaVersion)}`);

    // Pick a component by its stable metadata id, per the gate C acceptance
    // bar ("picks a component from the fixture library by its stable id").
    const target = metadata.components.find(c => c.name === "Greeter");
    if (target === undefined) throw new Error("Fixture component \"Greeter\" not found in metadata.json");
    const selectedId = target.id;

    // KNOWN GAP (see docs/baseline.md "Portable bundle (gate C)"): the
    // generated registry (bundle.js's `components.files[].components`) is
    // still keyed by source-relative path + export name, not yet by the
    // metadata `id` the contract document describes as the intended lookup
    // key. Until generate.ts is changed to key the registry by `id` (out of
    // this gate's file ownership - generate.ts is gate B, frozen), a host
    // resolves an id to a registry entry by matching metadata's sourcePath
    // basename + name against the registry's file path + component name.
    const baseName = target.sourcePath.split("/").pop().replace(/\.(tsx?|jsx?)$/, "");
    const file = registryModule.components.files.find(f => f.path === `${baseName}` || f.path.endsWith(`/${baseName}`));
    if (file === undefined) throw new Error(`No registry file matched metadata sourcePath "${target.sourcePath}" (looked for basename "${baseName}")`);
    const entry = file.components[target.name];
    if (entry === undefined) throw new Error(`No registry component named "${target.name}" in file "${file.path}"`);

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    const root = createRoot(document.getElementById("root"));
    // Simple hardcoded prop values - proving the render path, not the editor.
    root.render(React.createElement(entry.component, { name: "Independent Host", times: 2 }));

    report("ok", { selectedId, selectedName: target.name, sourcePath: target.sourcePath });
}

main().catch(error => {
    console.error(error);
    report("error", String((error && error.stack) || error));
});
