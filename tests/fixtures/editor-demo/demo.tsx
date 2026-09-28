// Interactive composition-editor demo (docs/claude-handoff.md gate D
// acceptance line, made real and interactive in a browser - see
// docs/baseline.md "Interactive browser verification"). Extended in phase 3
// (docs/claude-slots-handoff.md) with real slot outlets: an insertable/
// reorderable "actions" nodes slot, a policy-restricted "icon" componentRef
// picker, and a mark-restricted "caption" richText editor - all driven
// through packages/editor/src/slots.ts, which calls the SAME
// `checkSlotValue`/`resolveSlotPolicy` pair `packages/runtime`'s own
// validation uses (docs/slot-contract.md section 8).
//
// A real, mounted React app (react-dom/client's createRoot), not a static
// render. This file is bundled by scripts/build-editor-demo.cjs into a
// single browser ESM file (demo.js) that tests/fixtures/editor-demo/index.html
// loads as a plain `<script type="module">`. It fetches the real generated
// metadata.json and dynamically imports the real generated bundle.js - both
// produced by `forge codegen` + `forge bundle` against forge.demo.config.ts
// (which reuses the real SlotCard/Greeter/Card fixture components from
// tests/fixtures/bundle-project/, not a hand-rolled registry, now with
// `annotationSources.colocated: true` so SlotCard's real slot rules load).
import {createRoot} from "react-dom/client"
import {useEffect, useMemo, useState} from "react"
import {
    checkRichTextValue,
    computeComponentRefPalette,
    computeInsertablePalette,
    getInstanceAtPath,
    insertSlotItem,
    isTextInsertable,
    moveSlotItem,
    newInstanceItem,
    newTextItem,
    plainRichText,
    removeSlotItem,
    setComponentRefProp,
    setRichTextContent,
    setRichTextProp,
    toggleRichTextMark,
    useComponentPreview
} from "@reactive-forge/editor"
import type {CompositionDocument, CompositionSlotItem, ValidationResult} from "@reactive-forge/runtime"
import type {ComponentIdentity, ComponentLibraryData, ComponentMetadata, MetadataDocument, RichTextMark} from "@reactive-forge/schema"

const METADATA_URL = "./out-demo/metadata.json"
const BUNDLE_URL = "./out-demo/bundle.js"
const STORAGE_KEY = "reactive-forge-editor-demo-composition-v2"

function findComponentMeta(metadata: MetadataDocument, name: string): ComponentMetadata {
    const found = metadata.components.find(c => c.name === name)
    if (found === undefined) throw new Error(`metadata.json has no component named "${name}"`)
    return found
}

function buildInitialDocument(slotCardId: string, slotIconId: string): CompositionDocument {
    return {
        schemaVersion: 2,
        root: {
            kind: "instance",
            instanceId: "root",
            componentId: slotCardId,
            props: {
                header: {kind: "nodes", value: {items: [{itemId: "h1", kind: "text", value: "Reactive Forge Demo"}]}},
                actions: {kind: "nodes", value: {items: []}},
                icon: {kind: "componentRef", value: {source: "project", id: slotIconId}},
                caption: {kind: "richText", value: plainRichText("Edit me", false)}
            }
        }
    }
}

interface LoadedLibrary {
    metadata: MetadataDocument
    library: ComponentLibraryData
}

/** Fetches metadata.json and dynamically import()s bundle.js - the real generated gate-C artifacts, never a hand-rolled registry. */
function useLoadedLibrary(): { state: LoadedLibrary | null, error: Error | null } {
    const [state, setState] = useState<LoadedLibrary | null>(null)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
        let cancelled = false
        void (async () => {
            try {
                const metadataResponse = await fetch(METADATA_URL)
                if (!metadataResponse.ok) throw new Error(`Could not fetch metadata.json: ${String(metadataResponse.status)}`)
                const metadata = await metadataResponse.json() as MetadataDocument
                const registryModule = await import(/* webpackIgnore: true */ BUNDLE_URL) as { components: ComponentLibraryData }
                if (!cancelled) setState({metadata, library: registryModule.components})
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)))
            }
        })()
        return () => { cancelled = true }
    }, [])

    return {state, error}
}

function DiagnosticsList({diagnostics}: { diagnostics: ValidationResult["diagnostics"] }) {
    if (diagnostics.length === 0) {
        return <div data-testid="diagnostics" data-valid="true">No diagnostics — composition is valid.</div>
    }
    return (
        <ul data-testid="diagnostics" data-valid="false">
            {diagnostics.map((d, i) => (
                <li key={i} data-severity={d.severity}>[{d.severity}] {d.code}: {d.message} (at {JSON.stringify(d.path)})</li>
            ))}
        </ul>
    )
}

/**
 * A "nodes"-kind slot outlet: shows the slot's current items (with remove/move-up/
 * move-down controls per item, proving reordering + removal), an "insert text" field,
 * and a palette of insertable components computed via `computeInsertablePalette` (which
 * calls `checkSlotValue` under the hood) - each palette button attempts a real
 * `insertSlotItem` call and surfaces its `reason` on rejection, never silently no-oping.
 */
function SlotOutlet({
    testId, label, hostComponent, propName, items, metadata, library, onInsert, onRemove, onMove
}: {
    testId: string
    label: string
    hostComponent: ComponentMetadata
    propName: string
    items: CompositionSlotItem[]
    metadata: MetadataDocument
    library: ComponentLibraryData
    onInsert: (item: CompositionSlotItem, index: number) => { ok: boolean, reason?: string }
    onRemove: (itemId: string) => void
    onMove: (from: number, to: number) => void
}) {
    const [textDraft, setTextDraft] = useState("")
    const [lastRejection, setLastRejection] = useState<string | null>(null)
    const palette = useMemo(
        () => computeInsertablePalette(hostComponent, propName, items, items.length, metadata, library),
        [hostComponent, propName, items, metadata, library]
    )
    const textInsertable = isTextInsertable(hostComponent, propName)

    function attemptInsert(item: CompositionSlotItem) {
        const result = onInsert(item, items.length)
        setLastRejection(result.ok ? null : (result.reason ?? "Rejected."))
    }

    return (
        <div data-testid={testId}>
            <h3>{label}</h3>
            <ul data-testid={`${testId}-items`}>
                {items.map((item, index) => (
                    <li key={item.itemId} data-testid={`${testId}-item-${item.itemId}`}>
                        <span data-testid={`${testId}-item-${item.itemId}-desc`}>
                            {item.kind === "text" ? `text: "${item.value}"` : item.kind === "void" ? "(void)" : `instance: ${item.instance.componentId}`}
                        </span>
                        {" "}
                        <button type="button" data-testid={`${testId}-item-${item.itemId}-up`} disabled={index === 0} onClick={() => { onMove(index, index - 1) }}>↑</button>
                        <button type="button" data-testid={`${testId}-item-${item.itemId}-down`} disabled={index === items.length - 1} onClick={() => { onMove(index, index + 1) }}>↓</button>
                        <button type="button" data-testid={`${testId}-item-${item.itemId}-remove`} onClick={() => { onRemove(item.itemId) }}>Remove</button>
                    </li>
                ))}
            </ul>
            <div data-testid={`${testId}-palette`}>
                {palette.map(({component, result}) => (
                    <button
                        type="button"
                        key={component.id}
                        data-testid={`${testId}-insert-${component.name}`}
                        disabled={!result.ok}
                        title={result.ok ? undefined : result.diagnostics.map(d => d.message).join("; ")}
                        onClick={() => { attemptInsert(newInstanceItem(component.id)) }}
                    >
                        {result.ok ? `Insert ${component.name}` : `${component.name} (rejected)`}
                    </button>
                ))}
                {textInsertable && (
                    <>
                        <input data-testid={`${testId}-text-input`} value={textDraft} onChange={e => { setTextDraft(e.target.value) }} />
                        <button type="button" data-testid={`${testId}-insert-text`} onClick={() => { attemptInsert(newTextItem(textDraft)); setTextDraft("") }}>Insert text</button>
                    </>
                )}
            </div>
            {lastRejection !== null && <div data-testid={`${testId}-rejection`}>Rejected: {lastRejection}</div>}
        </div>
    )
}

/** A `"componentRef"`-kind prop picker, restricted to the resolved policy's `accepts` list via `checkSlotValue`. */
function ComponentRefOutlet({
    testId, hostComponent, propName, current, metadata, library, onSet
}: {
    testId: string
    hostComponent: ComponentMetadata
    propName: string
    current: ComponentIdentity
    metadata: MetadataDocument
    library: ComponentLibraryData
    onSet: (identity: ComponentIdentity) => { ok: boolean, reason?: string }
}) {
    const [lastRejection, setLastRejection] = useState<string | null>(null)
    const palette = useMemo(() => computeComponentRefPalette(hostComponent, propName, metadata, library), [hostComponent, propName, metadata, library])

    return (
        <div data-testid={testId}>
            <h3>{propName} (componentRef)</h3>
            <div data-testid={`${testId}-current`}>Current: {current.source === "project" ? current.id : "external"}</div>
            {palette.map(({component, result}) => (
                <button
                    type="button"
                    key={component.id}
                    data-testid={`${testId}-set-${component.name}`}
                    disabled={!result.ok}
                    title={result.ok ? undefined : result.diagnostics.map(d => d.message).join("; ")}
                    onClick={() => {
                        const outcome = onSet({source: "project", id: component.id})
                        setLastRejection(outcome.ok ? null : (outcome.reason ?? "Rejected."))
                    }}
                >
                    {result.ok ? `Use ${component.name}` : `${component.name} (rejected)`}
                </button>
            ))}
            {lastRejection !== null && <div data-testid={`${testId}-rejection`}>Rejected: {lastRejection}</div>}
        </div>
    )
}

/** A `"richText"`-kind prop outlet: plain-text content editing plus bold/italic mark toggles, validated through `checkSlotValue`. */
function RichTextOutlet({
    testId, hostComponent, propName, value, library, onChange
}: {
    testId: string
    hostComponent: ComponentMetadata
    propName: string
    value: import("@reactive-forge/schema").RichTextValueJson
    library: ComponentLibraryData
    onChange: (next: import("@reactive-forge/schema").RichTextValueJson) => { ok: boolean, reason?: string }
}) {
    const [lastRejection, setLastRejection] = useState<string | null>(null)
    const text = value.inline
        ? (value.nodes[0]?.text ?? "")
        : (value.nodes[0]?.type === "paragraph" ? value.nodes[0].children[0]?.text ?? "" : "")
    const activeMarks = value.inline
        ? (value.nodes[0]?.marks ?? [])
        : (value.nodes[0]?.type === "paragraph" ? value.nodes[0].children[0]?.marks ?? [] : [])

    function attempt(next: import("@reactive-forge/schema").RichTextValueJson) {
        const outcome = onChange(next)
        setLastRejection(outcome.ok ? null : (outcome.reason ?? "Rejected."))
    }

    function toggleMark(mark: RichTextMark) {
        // Validate BEFORE committing (checkRichTextValue calls the same checkSlotValue path
        // onChange itself uses) purely so this outlet can show the rejection reason without
        // relying on onChange's own state update timing.
        const next = toggleRichTextMark(value, mark)
        const check = checkRichTextValue(hostComponent, propName, library, next)
        if (!check.ok) { setLastRejection(check.diagnostics.map(d => d.message).join("; ")); return }
        attempt(next)
    }

    return (
        <div data-testid={testId}>
            <h3>{propName} (richText)</h3>
            <textarea
                data-testid={`${testId}-text`}
                value={text}
                onChange={e => { attempt(setRichTextContent(value, e.target.value)) }}
            />
            <button type="button" data-testid={`${testId}-toggle-bold`} onClick={() => { toggleMark("bold") }}>
                {activeMarks.includes("bold") ? "Un-bold" : "Bold"}
            </button>
            <button type="button" data-testid={`${testId}-toggle-italic`} onClick={() => { toggleMark("italic") }}>
                {activeMarks.includes("italic") ? "Un-italic" : "Italic"}
            </button>
            {lastRejection !== null && <div data-testid={`${testId}-rejection`}>Rejected: {lastRejection}</div>}
        </div>
    )
}

/**
 * The worked example: `useComponentPreview` owns the composition document,
 * drives the live preview + diagnostics, and every outlet below routes its
 * edits through `preview.setDocument` plus the pure slot operations in
 * packages/editor/src/slots.ts - the same functions tests/editor.test.cjs
 * exercises through pure calls, wired here to real DOM controls instead.
 */
function Editor({metadata, library}: LoadedLibrary) {
    const slotCardMeta = useMemo(() => findComponentMeta(metadata, "SlotCard"), [metadata])
    const slotIconMeta = useMemo(() => findComponentMeta(metadata, "SlotIcon"), [metadata])

    const initialDocument = useMemo(() => buildInitialDocument(slotCardMeta.id, slotIconMeta.id), [slotCardMeta.id, slotIconMeta.id])
    const preview = useComponentPreview({metadata, library, initialDocument})

    const [savedJson, setSavedJson] = useState("")
    const [reloadStatus, setReloadStatus] = useState("")

    const root = getInstanceAtPath(preview.document, [])
    const headerItems = root.props.header?.kind === "nodes" ? root.props.header.value.items : []
    const actionsItems = root.props.actions?.kind === "nodes" ? root.props.actions.value.items : []
    const iconValue = root.props.icon?.kind === "componentRef" ? root.props.icon.value : {source: "project" as const, id: slotIconMeta.id}
    const captionValue = root.props.caption?.kind === "richText" ? root.props.caption.value : plainRichText("", false)

    function makeSlotOps(propName: "header" | "actions") {
        return {
            onInsert: (item: CompositionSlotItem, index: number) => {
                const result = insertSlotItem(preview.document, metadata, library, [], propName, index, item)
                preview.setDocument(result.document)
                return result.ok ? {ok: true} : {ok: false, reason: result.reason}
            },
            onRemove: (itemId: string) => { preview.setDocument(removeSlotItem(preview.document, [], propName, itemId)) },
            onMove: (from: number, to: number) => { preview.setDocument(moveSlotItem(preview.document, [], propName, from, to)) }
        }
    }

    function handleSave() {
        const json = JSON.stringify(preview.document, null, 2)
        setSavedJson(json)
        try { window.localStorage.setItem(STORAGE_KEY, json) } catch { /* private-browsing/quota: textarea still shows the snapshot */ }
        setReloadStatus("Saved.")
    }

    function handleReload() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY) ?? (savedJson || null)
            if (raw === null) { setReloadStatus("Nothing saved yet."); return }
            const parsed = JSON.parse(raw) as CompositionDocument
            preview.setDocument(parsed)
            setReloadStatus("Reloaded from saved snapshot.")
        } catch (e) {
            setReloadStatus(`Reload failed: ${e instanceof Error ? e.message : String(e)}`)
        }
    }

    return (
        <div>
            <h1>Reactive Forge composition editor demo — slot outlets</h1>

            <section data-testid="controls">
                <h2>SlotCard slots</h2>

                <SlotOutlet
                    testId="outlet-header"
                    label="header (any-policy nodes slot)"
                    hostComponent={slotCardMeta}
                    propName="header"
                    items={headerItems}
                    metadata={metadata}
                    library={library}
                    {...makeSlotOps("header")}
                />

                <SlotOutlet
                    testId="outlet-actions"
                    label="actions (each() any-policy, maxItems 1 per entry, collection maxItems 3)"
                    hostComponent={slotCardMeta}
                    propName="actions"
                    items={actionsItems}
                    metadata={metadata}
                    library={library}
                    {...makeSlotOps("actions")}
                />

                <ComponentRefOutlet
                    testId="outlet-icon"
                    hostComponent={slotCardMeta}
                    propName="icon"
                    current={iconValue}
                    metadata={metadata}
                    library={library}
                    onSet={(identity) => {
                        const result = setComponentRefProp(preview.document, metadata, library, [], "icon", identity)
                        preview.setDocument(result.document)
                        return result.ok ? {ok: true} : {ok: false, reason: result.reason}
                    }}
                />

                <RichTextOutlet
                    testId="outlet-caption"
                    hostComponent={slotCardMeta}
                    propName="caption"
                    value={captionValue}
                    library={library}
                    onChange={(next) => {
                        const result = setRichTextProp(preview.document, metadata, library, [], "caption", next)
                        preview.setDocument(result.document)
                        return result.ok ? {ok: true} : {ok: false, reason: result.reason}
                    }}
                />
            </section>

            <section data-testid="diagnostics-section">
                <h2>Diagnostics</h2>
                <DiagnosticsList diagnostics={preview.diagnostics} />
            </section>

            <section data-testid="preview-section">
                <h2>Live preview</h2>
                <div data-testid="preview-output">{preview.element}</div>
            </section>

            <section data-testid="save-reload">
                <h2>Save / reload</h2>
                <button type="button" data-testid="btn-save" onClick={handleSave}>Save to localStorage</button>
                <button type="button" data-testid="btn-reload" onClick={handleReload}>Reload from localStorage</button>
                <div data-testid="reload-status">{reloadStatus}</div>
                <textarea data-testid="save-textarea" readOnly rows={16} cols={70} value={savedJson} />
            </section>
        </div>
    )
}

function App() {
    const {state, error} = useLoadedLibrary()
    if (error !== null) return <div data-testid="load-error">Failed to load demo library: {error.message}</div>
    if (state === null) return <div data-testid="loading">Loading component library…</div>
    return <Editor metadata={state.metadata} library={state.library} />
}

const container = document.getElementById("root")
if (container === null) throw new Error("index.html is missing #root")
createRoot(container).render(<App />)
