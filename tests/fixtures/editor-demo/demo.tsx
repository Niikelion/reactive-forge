// Interactive composition-editor demo (docs/claude-handoff.md gate D
// acceptance line, made real and interactive in a browser - see
// docs/baseline.md "Interactive browser verification"). A real, mounted
// React app (react-dom/client's createRoot), not a static render.
//
// This file is bundled by scripts/build-editor-demo.cjs into a single
// browser ESM file (demo.js) that tests/fixtures/editor-demo/index.html
// loads as a plain `<script type="module">`. It fetches the real generated
// metadata.json and dynamically imports the real generated bundle.js -
// both produced by `forge codegen` + `forge bundle` against
// forge.demo.config.ts (which reuses the real Greeter/Card fixture
// components from tests/fixtures/bundle-project/, not a hand-rolled
// registry).
import {createRoot} from "react-dom/client"
import {useEffect, useMemo, useRef, useState} from "react"
import {getNodeAtPath, PropControl, setPropAtPath, useComponentPreview} from "@reactive-forge/editor"
import type {CompositionDocument, CompositionInstance, CompositionPropValue, ValidationResult} from "@reactive-forge/runtime"
import type {ComponentLibraryData, ComponentMetadata, MetadataDocument} from "@reactive-forge/schema"

const METADATA_URL = "./out-demo/metadata.json"
const BUNDLE_URL = "./out-demo/bundle.js"
const STORAGE_KEY = "reactive-forge-editor-demo-composition"

function findComponentMeta(metadata: MetadataDocument, name: string): ComponentMetadata {
    const found = metadata.components.find(c => c.name === name)
    if (found === undefined) throw new Error(`metadata.json has no component named "${name}"`)
    return found
}

function buildInitialDocument(cardId: string, greeterId: string): CompositionDocument {
    return {
        schemaVersion: 1,
        root: {
            kind: "instance",
            id: cardId,
            props: {
                title: {kind: "value", value: {type: "string", value: "Reactive Forge Demo"}},
                onRender: {kind: "callback", name: "onCardRender"}
            },
            children: [
                {
                    kind: "instance",
                    id: greeterId,
                    props: {
                        name: {kind: "value", value: {type: "string", value: "Composed Host"}},
                        times: {kind: "value", value: {type: "number", value: 1}}
                    }
                }
            ]
        }
    }
}

function newGreeterInstance(greeterId: string, index: number): CompositionInstance {
    return {
        kind: "instance",
        id: greeterId,
        props: {
            name: {kind: "value", value: {type: "string", value: `New Friend ${String(index)}`}},
            times: {kind: "value", value: {type: "number", value: 1}}
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
 * The worked example: `useComponentPreview` owns the composition document,
 * drives the live preview + diagnostics, and every control below routes its
 * edits through `preview.updateProp`/`preview.setDocument` - the same two
 * functions `tests/editor.test.cjs` exercises through pure calls, wired here
 * to real DOM controls instead.
 */
function Editor({metadata, library}: LoadedLibrary) {
    const cardMeta = useMemo(() => findComponentMeta(metadata, "Card"), [metadata])
    const greeterMeta = useMemo(() => findComponentMeta(metadata, "Greeter"), [metadata])

    // onRender fires synchronously during Card's own render (see
    // tests/fixtures/bundle-project/src/components/Card.tsx) - a ref, not
    // state, since setting state from inside a callback invoked mid-render
    // of a different component is not a safe React pattern. The counter is
    // still real: it increments on every render of Card, and is displayed
    // on the next re-render this demo already causes for other reasons.
    const renderCountRef = useRef(0)
    const callbacks = useMemo(() => ({
        onCardRender: () => { renderCountRef.current += 1 }
    }), [])

    const initialDocument = useMemo(() => buildInitialDocument(cardMeta.id, greeterMeta.id), [cardMeta.id, greeterMeta.id])

    const preview = useComponentPreview({metadata, library, initialDocument, callbacks})

    const [savedJson, setSavedJson] = useState("")
    const [reloadStatus, setReloadStatus] = useState("")

    const greeterChildren = (preview.document.root.children ?? [])
        .map((node, index) => ({node, index}))
        .filter((entry): entry is { node: CompositionInstance, index: number } =>
            entry.node.kind === "instance" && entry.node.id === greeterMeta.id)

    function updateChildProp(index: number, propName: string, value: CompositionPropValue) {
        preview.setDocument(setPropAtPath(preview.document, [index], propName, value))
    }

    function handleNest() {
        const children = preview.document.root.children ?? []
        const nextChild = newGreeterInstance(greeterMeta.id, children.length)
        preview.setDocument({
            ...preview.document,
            root: {...preview.document.root, children: [...children, nextChild]}
        })
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

    // Prove getNodeAtPath is a real, usable export too (not just used
    // internally by the hook) - resolves the same root node targetNode already is.
    const rootViaPath = getNodeAtPath(preview.document, [])

    return (
        <div>
            <h1>Reactive Forge composition editor demo</h1>

            <section data-testid="controls">
                <h2>Card props</h2>
                <label>
                    {"title "}
                    <PropControl
                        propMeta={cardMeta.props.title}
                        currentValue={rootViaPath.props.title}
                        callbacks={callbacks}
                        onChange={(value) => preview.updateProp("title", value)}
                    />
                </label>
                <br />
                <label>
                    {"onRender (callback) "}
                    <PropControl
                        propMeta={cardMeta.props.onRender}
                        currentValue={rootViaPath.props.onRender}
                        callbacks={callbacks}
                        onChange={(value) => preview.updateProp("onRender", value)}
                    />
                </label>
                <div data-testid="render-count">Card render callback has fired {renderCountRef.current} time(s) so far.</div>

                <h2>Nested Greeter children</h2>
                <button type="button" data-testid="btn-nest" onClick={handleNest}>Nest another Greeter</button>
                {greeterChildren.map(({node, index}) => (
                    <fieldset key={index} data-testid={`greeter-${String(index)}`}>
                        <legend>{`Greeter #${String(index)}`}</legend>
                        <label>
                            {"name "}
                            <PropControl
                                propMeta={greeterMeta.props.name}
                                currentValue={node.props.name}
                                callbacks={callbacks}
                                onChange={(value) => { updateChildProp(index, "name", value) }}
                            />
                        </label>
                        <br />
                        <label>
                            {"times "}
                            <PropControl
                                propMeta={greeterMeta.props.times}
                                currentValue={node.props.times}
                                callbacks={callbacks}
                                onChange={(value) => { updateChildProp(index, "times", value) }}
                            />
                        </label>
                    </fieldset>
                ))}
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
                <textarea data-testid="save-textarea" readOnly rows={12} cols={60} value={savedJson} />
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
