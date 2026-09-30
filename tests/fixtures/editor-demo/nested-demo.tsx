import {useMemo, useState} from "react"
import {ComponentPalette, CompositionEditor, generateId, plainRichText} from "@reactive-forge/editor"
import {exportToTsx, renderComposition, validateComposition} from "@reactive-forge/runtime"
import type {CompositionDocument, CompositionInstance, CompositionValue} from "@reactive-forge/runtime"
import type {ComponentLibraryData, ComponentMetadata, MetadataDocument} from "@reactive-forge/schema"

/** Host-provided defaults, shared by pointer drops and keyboard insertion. */
export function createDemoInstance(component: ComponentMetadata): CompositionInstance | undefined {
    const instance: CompositionInstance = {kind: "instance", instanceId: generateId("instance"), componentId: component.id, props: {}}
    if (component.name === "Greeter") {
        instance.props.name = {kind: "composed", value: {kind: "leaf", value: {type: "string", value: "Nested visitor"}}}
    }
    // Components without required arguments need no extra setup. Required arguments without
    // explicit demo defaults are refused; full insertion validation remains the final authority.
    if (Object.entries(component.props).some(([name, prop]) => prop.required && !(name in instance.props))) return undefined
    return instance
}

const text = (value: string): CompositionValue => ({kind: "leaf", value: {type: "string", value}})
const nodes = (value: string, itemId: string): CompositionValue => ({kind: "nodes", value: {items: [{kind: "text", itemId, value}]}})

export function buildNestedDocument(componentId: string): CompositionDocument {
    return {
        schemaVersion: 3,
        root: {
            kind: "instance", instanceId: "nested-root", componentId,
            props: {
                content: {kind: "composed", value: {kind: "object", fields: {
                    header: {kind: "object", fields: {
                        title: {kind: "richText", value: plainRichText("Editable nested title", true)},
                        subtitle: text("Drop a component into a section below")
                    }}
                }}},
                sections: {kind: "composed", value: {kind: "array", items: [
                    {itemId: "section-alpha", value: {kind: "object", fields: {heading: text("First section"), body: nodes("First body", "body-alpha")}}},
                    {itemId: "section-beta", value: {kind: "object", fields: {heading: text("Second section"), body: nodes("Second body", "body-beta")}}}
                ]}},
                actions: {kind: "composed", value: {kind: "array", items: [
                    {itemId: "action-pair", value: {kind: "nodes", value: {items: [
                        {kind: "text", itemId: "action-a", value: "Action A"},
                        {kind: "text", itemId: "action-b", value: "Action B"}
                    ]}}},
                    {itemId: "action-empty", value: {kind: "nodes", value: {items: []}}}
                ]}}
            }
        }
    }
}

export function NestedEditorDemo({metadata, library}: {metadata: MetadataDocument, library: ComponentLibraryData}) {
    const component = metadata.components.find(entry => entry.name === "NestedSlotCard")
    if (component === undefined) throw new Error("NestedSlotCard metadata is missing")
    const initialDocument = useMemo(() => buildNestedDocument(component.id), [component.id])
    const [document, setDocument] = useState(initialDocument)
    const [snapshot, setSnapshot] = useState("")
    const [source, setSource] = useState("")
    const [status, setStatus] = useState("")
    const validation = validateComposition(document, metadata, library)
    function save() {
        const json = JSON.stringify(document, null, 2)
        setSnapshot(json)
        try { localStorage.setItem("reactive-forge-nested-demo-v3", json) } catch { /* Snapshot remains available. */ }
        setStatus("Saved nested composition.")
    }
    function reload() {
        try {
            const raw = localStorage.getItem("reactive-forge-nested-demo-v3") ?? snapshot
            const next = JSON.parse(raw) as CompositionDocument
            const result = validateComposition(next, metadata, library)
            if (!result.valid) throw new Error(result.diagnostics.map(d => d.message).join("; "))
            setDocument(next)
            setStatus("Reloaded nested composition.")
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    }
    return <section data-testid="nested-editor-demo">
        <h1>Nested composition editor</h1>
        <p>Drag a component from the palette into the rendered slots, or use each slot’s keyboard picker.</p>
        <ComponentPalette metadata={metadata} />
        <CompositionEditor document={document} metadata={metadata} library={library} onChange={setDocument} createInstance={createDemoInstance} />
        <div data-testid="nested-validation" data-valid={String(validation.valid)}>{validation.valid ? "Nested composition is valid." : validation.diagnostics.map(d => d.message).join("; ")}</div>
        <h2>Runtime output</h2>
        <div data-testid="nested-runtime">{validation.valid ? renderComposition(document, metadata, library) : null}</div>
        <button type="button" data-testid="nested-save" onClick={save}>Save nested composition</button>
        <button type="button" data-testid="nested-reload" onClick={reload}>Reload nested composition</button>
        <button type="button" data-testid="nested-export" onClick={() => {
            try { setSource(exportToTsx(document, metadata, library)); setStatus("Exported nested composition.") }
            catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
        }}>Export nested TSX</button>
        <div role="status" data-testid="nested-status">{status}</div>
        <textarea aria-label="Saved nested composition" data-testid="nested-snapshot" readOnly value={snapshot} rows={8} cols={80} />
        <pre data-testid="nested-export-output">{source}</pre>
    </section>
}
