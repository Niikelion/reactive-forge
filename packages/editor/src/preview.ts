import {ReactElement, useCallback, useMemo, useState} from "react"
import {
    CallbackRegistry,
    CompositionDocument,
    CompositionInstance,
    CompositionNode,
    CompositionPropValue,
    CompositionValidationError,
    renderComposition,
    ValidationResult,
    validateComposition
} from "@reactive-forge/runtime"
import {ComponentLibraryData, MetadataDocument} from "@reactive-forge/schema"

// Editor-adapter preview hook (docs/development-plan.md point 5: "Editor
// adapters: consume the same metadata/runtime and provide replaceable prop
// controls"). This module is deliberately split into:
//
//  - pure, framework-agnostic helpers (`getNodeAtPath`, `setPropAtPath`,
//    `computePreviewState`) that own no React state and can be unit-tested
//    directly, without a DOM/renderer - see tests/editor.test.cjs; and
//  - `useComponentPreview`, a thin React hook built on top of them.
//
// State-ownership judgment call (handoff explicitly asks for one): the hook
// owns the `CompositionDocument` in React state internally (`useState`),
// rather than requiring a controlled `document`/`onChange` pair from the
// caller. This gate's acceptance bar is a *small worked example* proving
// "edit props, nest components, save/reload, render equivalent output" -
// internal ownership keeps that example's call site to a few lines. A
// controlled variant is more flexible for a real multi-panel editor (undo
// stacks, syncing with other UI), but adds boilerplate this gate doesn't
// need; `setDocument` is still exposed on the returned handle so a caller
// *can* replace the whole document from outside (e.g. after a "reload from
// disk" action), which covers the save/reload half of the acceptance bar
// without requiring full controlled-component plumbing.

/**
 * Identifies one `CompositionInstance` inside a document by the sequence of
 * child indices from the root (`[]` is the root itself, `[0]` is the root's
 * first child, `[0, 1]` that child's second child, etc). Kept as a plain
 * array of numbers - not a node identity/id - because `CompositionInstance`
 * has no stable per-node id of its own (only component-level ids); a path is
 * the only addressing scheme the composition document contract supports.
 */
export type CompositionPath = number[]

/**
 * Looks up the `CompositionInstance` at `path` inside `doc`. Throws if the
 * path does not resolve to an instance (out of range, or resolves to a text/
 * void leaf) - a programming error in the caller, not a validation concern.
 */
export function getNodeAtPath(doc: CompositionDocument, path: CompositionPath): CompositionInstance {
    let node: CompositionNode = doc.root
    for (const index of path) {
        if (node.kind !== "instance") throw new Error(`Path ${JSON.stringify(path)} does not resolve to an instance: ancestor is a "${node.kind}" leaf`)
        const children: CompositionNode[] = node.children ?? []
        const child: CompositionNode | undefined = children[index]
        if (child === undefined) throw new Error(`Path ${JSON.stringify(path)} is out of range: no child at index ${String(index)}`)
        node = child
    }
    if (node.kind !== "instance") throw new Error(`Path ${JSON.stringify(path)} does not resolve to an instance, found a "${node.kind}" leaf`)
    return node
}

/**
 * Returns a new `CompositionDocument` with the prop `propName` on the
 * instance at `path` set to `value`, leaving everything else structurally
 * shared (only the spine from the root down to `path` is copied). Never
 * mutates `doc`.
 */
export function setPropAtPath(
    doc: CompositionDocument,
    path: CompositionPath,
    propName: string,
    value: CompositionPropValue
): CompositionDocument {
    function rewrite(node: CompositionInstance, remaining: CompositionPath): CompositionInstance {
        if (remaining.length === 0) {
            return {...node, props: {...node.props, [propName]: value}}
        }
        const [index, ...rest] = remaining as [number, ...number[]]
        const children = node.children ?? []
        const target = children[index]
        if (target === undefined || target.kind !== "instance")
            throw new Error(`Path ${JSON.stringify(path)} is out of range or does not resolve to an instance`)
        const nextChildren = children.slice()
        nextChildren[index] = rewrite(target, rest)
        return {...node, children: nextChildren}
    }
    return {...doc, root: rewrite(doc.root, path)}
}

export interface PreviewState {
    document: CompositionDocument
    /** `null` when the document does not currently validate; see `validation`/`error`. */
    element: ReactElement | null
    validation: ValidationResult
    /** Set when validation passed but `renderComposition` itself threw (e.g. a registry gap). */
    error?: Error
}

/**
 * Pure computation: validates `document` against `metadata`/`library`, and -
 * only if valid - renders it via `@reactive-forge/runtime`'s
 * `renderComposition`. Never throws; a failure of either step is reported in
 * the returned state instead, so a live-editing UI can show diagnostics
 * without crashing mid-edit. This is the function the "live re-render" half
 * of the preview hook boils down to; `useComponentPreview` just re-runs it
 * whenever the document (or its inputs) change.
 */
export function computePreviewState(
    document: CompositionDocument,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry
): PreviewState {
    const validation = validateComposition(document, metadata, library, callbacks)
    if (!validation.valid) return {document, element: null, validation}
    try {
        const element = renderComposition(document, metadata, library, {callbacks})
        return {document, element, validation}
    } catch (error) {
        if (error instanceof CompositionValidationError) {
            // Should not happen given validation.valid above, but keep the
            // contract honest rather than letting it bubble as an unhandled throw.
            return {document, element: null, validation: {valid: false, diagnostics: error.diagnostics}}
        }
        return {document, element: null, validation, error: error instanceof Error ? error : new Error(String(error))}
    }
}

export interface UseComponentPreviewOptions {
    metadata: MetadataDocument
    library: ComponentLibraryData
    initialDocument: CompositionDocument
    /** Host-supplied named callback bindings; see `CallbackRegistry` in `@reactive-forge/runtime`. */
    callbacks?: CallbackRegistry
    /** Which instance prop edits target; defaults to the document root (`[]`). */
    targetPath?: CompositionPath
}

export interface ComponentPreviewHandle {
    /** The current composition document (owned internally by this hook - see module doc comment). */
    document: CompositionDocument
    /** The `CompositionInstance` at `targetPath`, i.e. the node prop controls should edit. */
    targetNode: CompositionInstance
    /** The live rendered element for `document`, or `null` if it doesn't currently validate. */
    element: ReactElement | null
    /** Structured diagnostics from the last validation pass (empty when valid). */
    diagnostics: ValidationResult["diagnostics"]
    valid: boolean
    /** Sets a prop on the target node and re-renders. This is what prop controls call. */
    updateProp: (propName: string, value: CompositionPropValue) => void
    /** Replaces the whole document (e.g. after loading a saved one from disk/storage). */
    setDocument: (document: CompositionDocument) => void
}

/**
 * React hook driving the "edit a prop, see the rendered component update
 * immediately" loop on top of `@reactive-forge/runtime`. See the module doc
 * comment for the state-ownership rationale.
 */
export function useComponentPreview(options: UseComponentPreviewOptions): ComponentPreviewHandle {
    const {metadata, library, initialDocument, callbacks, targetPath} = options
    const [document, setDocument] = useState(initialDocument)
    const path = targetPath ?? []
    const resolvedCallbacks = callbacks ?? {}

    const state = useMemo(
        () => computePreviewState(document, metadata, library, resolvedCallbacks),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- resolvedCallbacks is a fresh object per render when the caller omits `callbacks`; identity-comparing `callbacks` itself is the intent.
        [document, metadata, library, callbacks]
    )

    const updateProp = useCallback((propName: string, value: CompositionPropValue) => {
        setDocument(current => setPropAtPath(current, path, propName, value))
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `path` is derived per-render from `targetPath`; re-created array identity would defeat memoization for no benefit since it's read, not compared.
    }, [JSON.stringify(path)])

    const targetNode = getNodeAtPath(document, path)

    return {
        document,
        targetNode,
        element: state.element,
        diagnostics: state.validation.diagnostics,
        valid: state.validation.valid,
        updateProp,
        setDocument
    }
}
