import {ReactElement, useCallback, useMemo, useState} from "react"
import {
    CallbackRegistry,
    CompositionDocument,
    CompositionInstance,
    CompositionPropValue,
    CompositionSlotItem,
    CompositionValidationError,
    CompositionValue,
    renderComposition,
    ValidationResult,
    validateComposition
} from "@reactive-forge/runtime"
import {ComponentLibraryData, MetadataDocument, VariantLiteral} from "@reactive-forge/schema"

// Editor-adapter preview hook (docs/development-plan.md point 5: "Editor
// adapters: consume the same metadata/runtime and provide replaceable prop
// controls"). This module is deliberately split into:
//
//  - pure, framework-agnostic helpers (`getValueAtPath`/`getInstanceAtPath`,
//    `updateValueAtPath`/`updateInstanceAtPath`, `setPropAtPath`,
//    `setVariantBranch`, `computePreviewState`, plus the slot operations in
//    slots.ts) that own no React state and can be unit-tested directly,
//    without a DOM/renderer - see tests/editor.test.cjs; and
//  - `useComponentPreview`, a thin React hook built on top of them.
//
// ADDRESSING (docs/slot-contract-recursive.md section 3, "Editor addressing
// generalization"): v1's `CompositionPath` was a plain array of child
// indices (`[0, 1]` = root's first child's second child). v2 retired that
// scheme for a one-level `InstancePath` chain of `{propName, itemId}` steps
// (descend into the `"nodes"` slot at `propName`, then into the item whose
// `itemId` is `itemId`) - reordering never invalidates a path built this
// way, since it re-resolves by id, not position. v3's recursive
// `CompositionValue` model (packages/runtime/src/composition.ts) generalizes
// this to arbitrary depth: a `ValuePath` is a chain of `ValuePathStep`s, each
// one dictated by what its *source* kind can be - `"prop"` only ever follows
// a `CompositionInstance`, `"field"` only follows an `"object"` value,
// `"arrayItem"` only follows an `"array"` value (resolved by `itemId`,
// never position), `"variant"` only follows a `"variant"` value,
// `"slotItem"` only follows a `"nodes"` value (resolved by `itemId`), and
// `"instance"` only follows a `"slotItem"` step landing on a
// `{kind:"instance"}` item. `InstancePath` is kept as a deprecated alias -
// `type InstancePath = ValuePath` - for existing one-level call sites; new
// nested-addressing call sites use `ValuePath` directly.
export type ValuePathStep =
    | { kind: "prop", propName: string }
    | { kind: "field", name: string }
    | { kind: "arrayItem", itemId: string }
    | { kind: "variant" }
    | { kind: "slotItem", itemId: string }
    | { kind: "instance" }

export type ValuePath = ValuePathStep[]

/**
 * @deprecated Use `ValuePath` for new call sites. Kept as a type-level alias
 * (docs/slot-contract-recursive.md section 7.4) so existing one-level callers
 * keep compiling; TypeScript cannot express "restricted to exactly the
 * one-level `[prop, slotItem, instance]` shape" as a distinct type, so this
 * is simply `ValuePath` under an old name.
 */
export type InstancePath = ValuePath

/** @deprecated Use `ValuePathStep`. */
export type InstancePathStep = ValuePathStep

// ---------------------------------------------------------------------------------------------
// Internal walk representation: a path alternates between three "current position" shapes -
// sitting on a whole instance (about to take a "prop" step), sitting on a CompositionValue
// (about to take a "field"/"arrayItem"/"variant" step, or a "slotItem" step that changes shape
// again), or sitting on a resolved CompositionSlotItem (only ever followed by an "instance"
// step). One recursive walker handles all three uniformly instead of three separate ones.
// ---------------------------------------------------------------------------------------------
type WalkNode =
    | { tag: "instance", instance: CompositionInstance }
    | { tag: "value", value: CompositionValue }
    | { tag: "slotItem", item: CompositionSlotItem }

function stepInto(node: WalkNode, step: ValuePathStep): WalkNode {
    switch (step.kind) {
        case "prop": {
            if (node.tag !== "instance")
                throw new Error(`"prop" step requires the current position to be a CompositionInstance`)
            const prop = node.instance.props[step.propName]
            if (prop === undefined || prop.kind !== "composed")
                throw new Error(`Prop "${step.propName}" is not a "composed" value on instance "${node.instance.instanceId}"`)
            return {tag: "value", value: prop.value}
        }
        case "field": {
            if (node.tag !== "value" || node.value.kind !== "object")
                throw new Error(`"field" step requires an "object"-kind CompositionValue`)
            const child = node.value.fields[step.name]
            if (child === undefined) throw new Error(`No field "${step.name}" in this "object" value`)
            return {tag: "value", value: child}
        }
        case "arrayItem": {
            if (node.tag !== "value" || node.value.kind !== "array")
                throw new Error(`"arrayItem" step requires an "array"-kind CompositionValue`)
            const item = node.value.items.find(i => i.itemId === step.itemId)
            if (item === undefined) throw new Error(`No array item with itemId "${step.itemId}"`)
            return {tag: "value", value: item.value}
        }
        case "variant": {
            if (node.tag !== "value" || node.value.kind !== "variant")
                throw new Error(`"variant" step requires a "variant"-kind CompositionValue`)
            return {tag: "value", value: node.value.value}
        }
        case "slotItem": {
            if (node.tag !== "value" || node.value.kind !== "nodes")
                throw new Error(`"slotItem" step requires a "nodes"-kind CompositionValue`)
            const item = node.value.value.items.find(i => i.itemId === step.itemId)
            if (item === undefined) throw new Error(`No slot item with itemId "${step.itemId}"`)
            return {tag: "slotItem", item}
        }
        case "instance": {
            if (node.tag !== "slotItem" || node.item.kind !== "instance")
                throw new Error(`"instance" step requires a "slotItem" step that landed on a {kind:"instance"} item`)
            return {tag: "instance", instance: node.item.instance}
        }
    }
}

function walk(start: WalkNode, path: ValuePath): WalkNode {
    let node = start
    for (const step of path) node = stepInto(node, step)
    return node
}

/**
 * Resolves the `CompositionValue` reached from `instance`'s own props by walking `path` -
 * `path`'s first step must be `"prop"` (an instance's props are the only place a `ValuePath`
 * can start from). Throws (a caller/programming-error condition) if any step's source shape
 * doesn't match, or if an id-addressed step names an item that no longer exists.
 */
export function getValueAtPath(instance: CompositionInstance, path: ValuePath): CompositionValue {
    if (path.length === 0)
        throw new Error("getValueAtPath requires a non-empty path (an instance itself is not a CompositionValue)")
    const result = walk({tag: "instance", instance}, path)
    if (result.tag !== "value")
        throw new Error(`Path does not resolve to a CompositionValue (ended on a "${result.tag}")`)
    return result.value
}

/**
 * Looks up the `CompositionInstance` at `path` inside `doc`, resolving every id-bearing step
 * (`"arrayItem"`/`"slotItem"`) by `itemId` rather than array position - the direct
 * generalization of the old one-level `getInstanceAtPath` to arbitrary depth
 * (docs/slot-contract-recursive.md section 3.1). `path: []` addresses the document root itself.
 */
export function getInstanceAtPath(document: CompositionDocument, path: ValuePath): CompositionInstance {
    const result = walk({tag: "instance", instance: document.root}, path)
    if (result.tag !== "instance")
        throw new Error(`Path does not resolve to a CompositionInstance (ended on a "${result.tag}")`)
    return result.instance
}

/** Back-compat alias kept for call sites/tests migrating from the v1 name. */
export const getNodeAtPath = getInstanceAtPath

// ---------------------------------------------------------------------------------------------
// Rewrite: a recursive spine-copy mirroring `walk` above - at each step, recurse into the child
// position first, then rebuild the CURRENT node with only that one child replaced (everything
// else on the node is carried over by reference). `finish` is invoked once the path is
// exhausted, replacing whatever "current position" was reached; its return tag must match what
// the caller (`updateValueAtPath`/`updateInstanceAtPath`/`setVariantBranch`) expects, and every
// intermediate step also validates the resulting child's tag matches what it can hold, so a
// caller mismatch (e.g. rewriting a "field" position to a bare CompositionInstance) fails fast.
// ---------------------------------------------------------------------------------------------
function rewriteNode(node: WalkNode, path: ValuePath, finish: (node: WalkNode) => WalkNode): WalkNode {
    if (path.length === 0) return finish(node)
    const [step, ...rest] = path as [ValuePathStep, ...ValuePath]

    switch (step.kind) {
        case "prop": {
            if (node.tag !== "instance")
                throw new Error(`"prop" step requires the current position to be a CompositionInstance`)
            const prop = node.instance.props[step.propName]
            if (prop === undefined || prop.kind !== "composed")
                throw new Error(`Prop "${step.propName}" is not a "composed" value on instance "${node.instance.instanceId}"`)
            const childResult = rewriteNode({tag: "value", value: prop.value}, rest, finish)
            if (childResult.tag !== "value")
                throw new Error(`A "prop" position must rewrite to a CompositionValue`)
            return {
                tag: "instance",
                instance: {
                    ...node.instance,
                    props: {...node.instance.props, [step.propName]: {kind: "composed", value: childResult.value}}
                }
            }
        }
        case "field": {
            if (node.tag !== "value" || node.value.kind !== "object")
                throw new Error(`"field" step requires an "object"-kind CompositionValue`)
            const child = node.value.fields[step.name]
            if (child === undefined) throw new Error(`No field "${step.name}" in this "object" value`)
            const childResult = rewriteNode({tag: "value", value: child}, rest, finish)
            if (childResult.tag !== "value")
                throw new Error(`A "field" position must rewrite to a CompositionValue`)
            return {tag: "value", value: {kind: "object", fields: {...node.value.fields, [step.name]: childResult.value}}}
        }
        case "arrayItem": {
            if (node.tag !== "value" || node.value.kind !== "array")
                throw new Error(`"arrayItem" step requires an "array"-kind CompositionValue`)
            const index = node.value.items.findIndex(i => i.itemId === step.itemId)
            if (index === -1) throw new Error(`No array item with itemId "${step.itemId}"`)
            const target = node.value.items[index]
            if (target === undefined) throw new Error(`No array item with itemId "${step.itemId}"`)
            const childResult = rewriteNode({tag: "value", value: target.value}, rest, finish)
            if (childResult.tag !== "value")
                throw new Error(`An "arrayItem" position must rewrite to a CompositionValue`)
            const nextItems = node.value.items.slice()
            nextItems[index] = {...target, value: childResult.value}
            return {tag: "value", value: {kind: "array", items: nextItems}}
        }
        case "variant": {
            if (node.tag !== "value" || node.value.kind !== "variant")
                throw new Error(`"variant" step requires a "variant"-kind CompositionValue`)
            const childResult = rewriteNode({tag: "value", value: node.value.value}, rest, finish)
            if (childResult.tag !== "value")
                throw new Error(`A "variant" position must rewrite to a CompositionValue`)
            return {tag: "value", value: {...node.value, value: childResult.value}}
        }
        case "slotItem": {
            if (node.tag !== "value" || node.value.kind !== "nodes")
                throw new Error(`"slotItem" step requires a "nodes"-kind CompositionValue`)
            const index = node.value.value.items.findIndex(i => i.itemId === step.itemId)
            if (index === -1) throw new Error(`No slot item with itemId "${step.itemId}"`)
            const target = node.value.value.items[index]
            if (target === undefined) throw new Error(`No slot item with itemId "${step.itemId}"`)
            const childResult = rewriteNode({tag: "slotItem", item: target}, rest, finish)
            if (childResult.tag !== "slotItem")
                throw new Error(`A "slotItem" position must rewrite to a CompositionSlotItem`)
            const nextItems = node.value.value.items.slice()
            nextItems[index] = childResult.item
            return {tag: "value", value: {kind: "nodes", value: {items: nextItems}}}
        }
        case "instance": {
            if (node.tag !== "slotItem" || node.item.kind !== "instance")
                throw new Error(`"instance" step requires a "slotItem" step that landed on a {kind:"instance"} item`)
            const childResult = rewriteNode({tag: "instance", instance: node.item.instance}, rest, finish)
            if (childResult.tag !== "instance")
                throw new Error(`An "instance" position must rewrite to a CompositionInstance`)
            return {tag: "slotItem", item: {...node.item, instance: childResult.instance}}
        }
    }
}

/**
 * Returns a new `CompositionInstance` with the `CompositionValue` at `path` (from `instance`'s
 * own props) replaced by `rewrite(currentValue)`, leaving everything else structurally shared -
 * only the spine from `instance` down to `path` is copied. Never mutates `instance`.
 */
export function updateValueAtPath(
    instance: CompositionInstance,
    path: ValuePath,
    rewrite: (value: CompositionValue) => CompositionValue
): CompositionInstance {
    if (path.length === 0)
        throw new Error("updateValueAtPath requires a non-empty path (an instance itself is not a CompositionValue)")
    const result = rewriteNode({tag: "instance", instance}, path, node => {
        if (node.tag !== "value") throw new Error(`Path does not resolve to a CompositionValue (ended on a "${node.tag}")`)
        return {tag: "value", value: rewrite(node.value)}
    })
    if (result.tag !== "instance") throw new Error("internal error: root rewrite did not return an instance")
    return result.instance
}

/**
 * Returns a new `CompositionDocument` with the instance at `path` replaced by
 * `rewrite(currentInstance)`, leaving everything else structurally shared (only the
 * spine from the root down to `path` is copied). Never mutates `doc`. The building
 * block every other document-editing helper (`setPropAtPath`, `setVariantBranch`, and the
 * slot operations in slots.ts) is implemented on top of. `path: []` targets the document root.
 */
export function updateInstanceAtPath(
    document: CompositionDocument,
    path: ValuePath,
    rewrite: (instance: CompositionInstance) => CompositionInstance
): CompositionDocument {
    const result = rewriteNode({tag: "instance", instance: document.root}, path, node => {
        if (node.tag !== "instance") throw new Error(`Path does not resolve to a CompositionInstance (ended on a "${node.tag}")`)
        return {tag: "instance", instance: rewrite(node.instance)}
    })
    if (result.tag !== "instance") throw new Error("internal error: root rewrite did not return an instance")
    return {...document, root: result.instance}
}

/**
 * Returns a new `CompositionDocument` with the prop `propName` on the
 * instance at `path` set to `value`, leaving everything else structurally
 * shared. Never mutates `doc`.
 */
export function setPropAtPath(
    doc: CompositionDocument,
    path: ValuePath,
    propName: string,
    value: CompositionPropValue
): CompositionDocument {
    return updateInstanceAtPath(doc, path, instance => ({...instance, props: {...instance.props, [propName]: value}}))
}

/**
 * Explicitly changes which union member is selected at `path` (docs/slot-contract-recursive.md
 * section 3.3) - the ONE deliberate operation allowed to materialize/replace a "variant" node
 * (or a not-yet-decomposed position) just to select a branch; nothing else in this module does
 * this implicitly. `path` addresses the position itself (its last step is typically a `"field"`/
 * `"arrayItem"`/`"prop"` step whose current value becomes the new `{kind:"variant", ...}` node -
 * a `"variant"` step is never part of `path` itself, since selecting a branch structurally
 * replaces this position rather than descending into an existing branch).
 */
export function setVariantBranch(
    document: CompositionDocument,
    path: ValuePath,
    selector: { prop: string, equals: VariantLiteral },
    initialValue: CompositionValue
): CompositionDocument {
    if (path.length === 0)
        throw new Error("setVariantBranch requires a non-empty path (the document root is never itself a union position)")
    const result = rewriteNode({tag: "instance", instance: document.root}, path, () => (
        {tag: "value", value: {kind: "variant", selector, value: initialValue}}
    ))
    if (result.tag !== "instance") throw new Error("internal error: root rewrite did not return an instance")
    return {...document, root: result.instance}
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
    callbacks: CallbackRegistry = {},
    props: Record<string, unknown> = {}
): PreviewState {
    const validation = validateComposition(document, metadata, library, callbacks, props)
    if (!validation.valid) return {document, element: null, validation}
    try {
        const element = renderComposition(document, metadata, library, {callbacks, props})
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
    /** Values for the composition's explicitly declared public props, including functions. */
    props?: Record<string, unknown>
    /** Which instance prop edits target; defaults to the document root (`[]`). */
    targetPath?: ValuePath
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
    const {metadata, library, initialDocument, callbacks, props, targetPath} = options
    const [document, setDocument] = useState(initialDocument)
    const path = targetPath ?? []
    const resolvedCallbacks = callbacks ?? {}

    const state = useMemo(
        () => computePreviewState(document, metadata, library, resolvedCallbacks, props),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- resolvedCallbacks is a fresh object per render when the caller omits `callbacks`; identity-comparing `callbacks` itself is the intent.
        [document, metadata, library, callbacks, props]
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
