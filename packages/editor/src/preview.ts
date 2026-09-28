import {ReactElement, useCallback, useMemo, useState} from "react"
import {
    CallbackRegistry,
    CompositionDocument,
    CompositionInstance,
    CompositionPropValue,
    CompositionSlotItem,
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
//  - pure, framework-agnostic helpers (`getInstanceAtPath`, `setPropAtPath`,
//    `computePreviewState`, plus the slot operations in slots.ts) that own no
//    React state and can be unit-tested directly, without a DOM/renderer -
//    see tests/editor.test.cjs; and
//  - `useComponentPreview`, a thin React hook built on top of them.
//
// ADDRESSING (phase 3 redesign): v1's `CompositionPath` was a plain array of
// child indices (`[0, 1]` = root's first child's second child). The v2
// composition document contract explicitly retired that scheme - a v2
// document has no sibling `children` array at all, and the contract's own
// stated reason for `instanceId`/`itemId` existing is that "child-index
// addressing is unsuitable as persistent drag/edit identity after array
// reordering" (docs/slot-contract.md's framing, restated in the phase-3
// handoff). `InstancePath` replaces it with a chain of stable ids: each step
// says "descend into the `"nodes"` slot at prop `propName`, then into the
// item whose `itemId` is `itemId`" - reordering that slot's `items` array
// never invalidates a path built this way, since it re-resolves by id, not
// position. `[]` still addresses the document root.
export interface InstancePathStep {
    propName: string
    itemId: string
}

export type InstancePath = InstancePathStep[]

function slotValueOf(instance: CompositionInstance, propName: string): CompositionSlotItem[] {
    const prop = instance.props[propName]
    if (prop === undefined || prop.kind !== "nodes")
        throw new Error(`Prop "${propName}" is not a "nodes"-kind slot on instance "${instance.instanceId}"`)
    return prop.value.items
}

/**
 * Looks up the `CompositionInstance` at `path` inside `doc`, resolving each step by
 * `itemId` inside the named slot rather than by array position. Throws if a step's
 * `propName` is not a `"nodes"` slot on the current instance, or if no item with that
 * `itemId` (of kind `"instance"`) exists in it - a programming error in the caller
 * (e.g. addressing an item that was since removed), not a validation concern.
 */
export function getInstanceAtPath(doc: CompositionDocument, path: InstancePath): CompositionInstance {
    let node: CompositionInstance = doc.root
    for (const step of path) {
        const items = slotValueOf(node, step.propName)
        const item = items.find(i => i.itemId === step.itemId)
        if (item === undefined)
            throw new Error(`No item with itemId "${step.itemId}" in slot "${step.propName}"`)
        if (item.kind !== "instance")
            throw new Error(`Item "${step.itemId}" in slot "${step.propName}" is a "${item.kind}" leaf, not an instance`)
        node = item.instance
    }
    return node
}

/** Back-compat alias kept for call sites/tests migrating from the v1 name. */
export const getNodeAtPath = getInstanceAtPath

/**
 * Returns a new `CompositionDocument` with the instance at `path` replaced by
 * `rewrite(currentInstance)`, leaving everything else structurally shared (only the
 * spine from the root down to `path` is copied). Never mutates `doc`. The building
 * block every other document-editing helper (`setPropAtPath`, and the slot operations
 * in slots.ts) is implemented on top of.
 */
export function updateInstanceAtPath(
    doc: CompositionDocument,
    path: InstancePath,
    rewrite: (instance: CompositionInstance) => CompositionInstance
): CompositionDocument {
    function go(node: CompositionInstance, remaining: InstancePath): CompositionInstance {
        if (remaining.length === 0) return rewrite(node)
        const [step, ...rest] = remaining as [InstancePathStep, ...InstancePath]
        const items = slotValueOf(node, step.propName)
        const index = items.findIndex(i => i.itemId === step.itemId)
        if (index === -1)
            throw new Error(`No item with itemId "${step.itemId}" in slot "${step.propName}"`)
        const target = items[index]
        if (target === undefined || target.kind !== "instance")
            throw new Error(`Item "${step.itemId}" in slot "${step.propName}" is not an instance`)
        const nextItems = items.slice()
        nextItems[index] = {...target, instance: go(target.instance, rest)}
        return {
            ...node,
            props: {
                ...node.props,
                [step.propName]: {kind: "nodes", value: {items: nextItems}}
            }
        }
    }
    return {...doc, root: go(doc.root, path)}
}

/**
 * Returns a new `CompositionDocument` with the prop `propName` on the
 * instance at `path` set to `value`, leaving everything else structurally
 * shared. Never mutates `doc`.
 */
export function setPropAtPath(
    doc: CompositionDocument,
    path: InstancePath,
    propName: string,
    value: CompositionPropValue
): CompositionDocument {
    return updateInstanceAtPath(doc, path, instance => ({...instance, props: {...instance.props, [propName]: value}}))
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
    targetPath?: InstancePath
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

    const targetNode = getInstanceAtPath(document, path)

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
