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

    // The generated registry's entries now carry the same stable `id` that
    // metadata.json uses (packages/codegen/src/hash.ts's `componentId`, used
    // both by generate.ts's registry entries and its metadata.json output),
    // so a host resolves a metadata id straight to a registry entry - no more
    // path/name heuristic matching (previously a documented known gap here).
    let entry;
    for (const file of registryModule.components.files) {
        for (const candidate of Object.values(file.components)) {
            if (candidate.id === selectedId) { entry = candidate; break; }
        }
        if (entry !== undefined) break;
    }
    if (entry === undefined) throw new Error(`No registry component with id "${selectedId}" (metadata name "${target.name}")`);

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
