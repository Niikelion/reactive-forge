import {
    checkSlotValue,
    ComponentIdentity,
    ComponentLibraryData,
    ComponentMetadata,
    Diagnostic,
    findComponentEntry,
    MetadataDocument,
    SlotCheckContext,
    SlotCheckResult,
    SlotItemCandidate
} from "@reactive-forge/schema"
import {CompositionArrayItem, CompositionDocument, CompositionInstance, CompositionSlotItem, CompositionValue, CallbackRegistry, validateComposition, resolvePropSlotRules} from "@reactive-forge/runtime"
import {getInstanceAtPath, updateInstanceAtPath, updateValueAtPath, ValuePath} from "./preview.js"

// Every document operation validates the complete candidate through the runtime
// validator before returning success. ValuePath preserves nested object/array
// boundaries and uses stable IDs when resolving an entry after a reorder.

// ---------------------------------------------------------------------------------------------
// id generation - new editor-created instances/items need their own opaque, stable
// identity (docs/slot-contract.md section 7). Unlike validate.ts's `migratedInstanceId`
// (a deterministic hash of v1 structural position, used ONLY for one-time v1->v2
// migration), a freshly-inserted item has no prior position to hash - any sufficiently
// unique opaque string satisfies the contract ("editor-generated, persisted per-instance
// identity, never recomputed from position"). `crypto.randomUUID` when available (every
// real browser and Node >= 14.17); a small fallback otherwise so this module has no hard
// runtime dependency on it.
// ---------------------------------------------------------------------------------------------
let idCounter = 0
export function generateId(prefix: string): string {
    const cryptoObj = (globalThis as {crypto?: {randomUUID?: () => string}}).crypto
    if (cryptoObj?.randomUUID) return `${prefix}-${cryptoObj.randomUUID()}`
    idCounter += 1
    return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function newTextItem(value: string): CompositionSlotItem {
    return {itemId: generateId("item"), kind: "text", value}
}

export function newVoidItem(): CompositionSlotItem {
    return {itemId: generateId("item"), kind: "void"}
}

export function newInstanceItem(componentId: string): CompositionSlotItem {
    return {
        itemId: generateId("item"),
        kind: "instance",
        instance: {kind: "instance", instanceId: generateId("instance"), componentId, props: {}}
    }
}

// ---------------------------------------------------------------------------------------------
// Palette filtering (docs/slot-contract.md section 8's "palette filtering" bullet):
// insertable components for a "nodes"-kind slot, computed by calling `checkSlotValue`
// against every candidate in the loaded ComponentLibraryData/MetadataDocument - only
// `ok: true` candidates are offered. `index` is where the candidate would land (0-based,
// insertion point among the slot's *current* items) - needed because a cardinality-
// bounded slot's acceptance depends on how many items already precede the new one.
// ---------------------------------------------------------------------------------------------
export interface PaletteEntry {
    component: ComponentMetadata
    result: SlotCheckResult
}

// Real bug fixed (Codex repair handoff finding #2): `currentItemCount`/`currentNonVoidCount` must
// reflect the FULL resulting slot - inserting at index 0 with one existing item and maxItems:1
// still exceeds the cap, regardless of where the new item lands. The previous `items.slice(0,
// index)` only counted items *before* the insertion point, so inserting anywhere but the very end
// undercounted and could commit an over-capacity document. `index` is unused for cardinality now
// (kept in the signature since callers still pass it, for palette-entry-at-a-specific-position
// semantics elsewhere) - insertion position never changes how many items the slot ends up holding.
function slotCheckContextFor(
    items: CompositionSlotItem[],
    _index: number,
    perEntry: boolean,
    library: ComponentLibraryData,
    metadata: MetadataDocument
): SlotCheckContext {
    if (perEntry) return {library, currentItemCount: 0, currentNonVoidCount: 0, metadata}
    return {
        library,
        currentItemCount: items.length,
        currentNonVoidCount: items.filter(i => i.kind !== "void").length,
        metadata
    }
}

/**
 * Every component in `metadata`, each checked via `checkSlotValue` against the slot policy
 * resolved for `propName` on `hostComponent` - the exact same policy/checker
 * `validateComposition` uses for this same path. Includes rejected entries too (with their
 * `result`), so a palette UI can show a disabled/greyed candidate with a reason rather than
 * silently omitting it - callers that only want the insertable subset should filter on
 * `result.ok`.
 */
export function computeInsertablePalette(
    hostComponent: ComponentMetadata,
    propName: string,
    currentItems: CompositionSlotItem[],
    insertAtIndex: number,
    metadata: MetadataDocument,
    library: ComponentLibraryData
): PaletteEntry[] {
    const rules = resolvePropSlotRules(hostComponent, propName)
    if (rules.itemRule?.slot === undefined) return []
    const context = slotCheckContextFor(currentItems, insertAtIndex, rules.perEntry, library, metadata)
    return metadata.components.map(component => {
        const candidate: SlotItemCandidate = {itemId: "candidate", kind: "instance", instance: {componentId: component.id}}
        return {component, result: checkSlotValue(rules.itemRule, candidate, context)}
    })
}

/** Whether plain text is insertable at all for this slot (an "any" policy accepts it; nothing else does). */
export function isTextInsertable(hostComponent: ComponentMetadata, propName: string): boolean {
    const rules = resolvePropSlotRules(hostComponent, propName)
    return rules.itemRule?.slot?.kind === "any"
}

// ---------------------------------------------------------------------------------------------
// Insertion (docs/slot-contract.md section 8's "insertion" bullet, and the acceptance case
// "rejects a forbidden drop... Feedback explains rejected drops... Invalid operations leave
// the document unchanged"). Validates via `checkSlotValue` BEFORE committing; on rejection the
// document reference returned is the SAME object passed in (never a shallow near-copy), so a
// caller can cheaply tell "nothing changed" via `===`.
// ---------------------------------------------------------------------------------------------
export type SlotOperationResult =
    | { ok: true, document: CompositionDocument }
    | { ok: false, document: CompositionDocument, reason: string, diagnostics: Diagnostic[] }

function findHostComponent(metadata: MetadataDocument, componentId: string): ComponentMetadata {
    const found = metadata.components.find(c => c.id === componentId)
    if (found === undefined) throw new Error(`No component with id "${componentId}" in the metadata document`)
    return found
}

function describeRejection(result: {ok: false, diagnostics: {message: string}[]}): string {
    return result.diagnostics.map(d => d.message).join("; ") || "Rejected by slot policy."
}

/** Validate the complete candidate, including ancestor collection limits and required props. */
function commitDocument(document: CompositionDocument, candidate: CompositionDocument,
    metadata: MetadataDocument, library: ComponentLibraryData, callbacks?: CallbackRegistry): SlotOperationResult {
    const result = validateComposition(candidate, metadata, library, callbacks)
    if (!result.valid) return {ok: false, document, reason: describeRejection({ok: false, diagnostics: result.diagnostics}), diagnostics: result.diagnostics}
    return {ok: true, document: candidate}
}

function rejection(document: CompositionDocument, error: unknown): SlotOperationResult {
    return {ok: false, document, reason: error instanceof Error ? error.message : String(error), diagnostics: []}
}

/** Transactional edit at an arbitrary nested value. Invalid edits return the original document. */
export function editValue(document: CompositionDocument, metadata: MetadataDocument,
    library: ComponentLibraryData, path: ValuePath,
    rewrite: (value: CompositionValue) => CompositionValue, callbacks?: CallbackRegistry): SlotOperationResult {
    try {
        const candidate = {...document, root: updateValueAtPath(document.root, path, rewrite)}
        return commitDocument(document, candidate, metadata, library, callbacks)
    } catch (error) { return rejection(document, error) }
}

function insertionIndex(index: number, length: number): void {
    if (!Number.isInteger(index) || index < 0 || index > length) throw new Error("Insertion index is outside the collection")
}

export function insertAtValuePath(document: CompositionDocument, metadata: MetadataDocument,
    library: ComponentLibraryData, path: ValuePath, index: number,
    item: CompositionSlotItem, callbacks?: CallbackRegistry): SlotOperationResult {
    return editValue(document, metadata, library, path, value => {
        if (value.kind !== "nodes") throw new Error("Insertion requires a nodes value")
        insertionIndex(index, value.value.items.length)
        const items = value.value.items.slice()
        items.splice(index, 0, item)
        return {...value, value: {...value.value, items}}
    }, callbacks)
}

export function insertArrayEntryAtPath(document: CompositionDocument, metadata: MetadataDocument,
    library: ComponentLibraryData, path: ValuePath, index: number,
    entry: CompositionArrayItem, callbacks?: CallbackRegistry): SlotOperationResult {
    return editValue(document, metadata, library, path, value => {
        if (value.kind !== "array") throw new Error("Entry insertion requires an array value")
        insertionIndex(index, value.items.length)
        const items = value.items.slice()
        items.splice(index, 0, entry)
        return {...value, items}
    }, callbacks)
}

export function removeAtValuePath(document: CompositionDocument, metadata: MetadataDocument,
    library: ComponentLibraryData, path: ValuePath, itemId: string,
    callbacks?: CallbackRegistry): SlotOperationResult {
    return editValue(document, metadata, library, path, value => {
        if (value.kind === "array") {
            if (!value.items.some(item => item.itemId === itemId)) throw new Error(`No array entry "${itemId}"`)
            return {...value, items: value.items.filter(item => item.itemId !== itemId)}
        }
        if (value.kind !== "nodes") throw new Error("Removal requires a nodes or array value")
        if (!value.value.items.some(item => item.itemId === itemId)) throw new Error(`No slot item "${itemId}"`)
        return {...value, value: {...value.value, items: value.value.items.filter(item => item.itemId !== itemId)}}
    }, callbacks)
}

function reorder<T>(items: T[], from: number, to: number): T[] {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length)
        throw new Error("Move index is outside the collection")
    const next = items.slice()
    const moved = next.splice(from, 1)[0]
    if (moved === undefined) throw new Error("No item at move index")
    next.splice(to, 0, moved)
    return next
}

export function moveAtValuePath(document: CompositionDocument, metadata: MetadataDocument,
    library: ComponentLibraryData, path: ValuePath, from: number, to: number,
    callbacks?: CallbackRegistry): SlotOperationResult {
    return editValue(document, metadata, library, path, value => {
        if (value.kind === "array") return {...value, items: reorder(value.items, from, to)}
        if (value.kind !== "nodes") throw new Error("Move requires a nodes or array value")
        return {...value, value: {...value.value, items: reorder(value.value.items, from, to)}}
    }, callbacks)
}

/** Compatibility convenience for top-level props. Array entries remain separate containers. */
export function insertSlotItem(document: CompositionDocument, metadata: MetadataDocument,
    library: ComponentLibraryData, path: ValuePath, propName: string, index: number,
    item: CompositionSlotItem, callbacks?: CallbackRegistry): SlotOperationResult {
    try {
        const host = getInstanceAtPath(document, path)
        const rules = resolvePropSlotRules(findHostComponent(metadata, host.componentId), propName)
        const prop = host.props[propName]
        if (prop !== undefined && prop.kind !== "composed") throw new Error("Target prop is not a composed value")
        const value = prop?.value ?? (rules.perEntry ? {kind: "array" as const, items: []} : {kind: "nodes" as const, value: {items: []}})
        const current = value.kind === "array" ? value.items : value.kind === "nodes" ? value.value.items : undefined
        if (!current) throw new Error("Insertion requires a nodes or array value")
        insertionIndex(index, current.length)
        let next: CompositionValue
        if (value.kind === "array") {
            const items = value.items.slice()
            items.splice(index, 0, {itemId: generateId("entry"), value: {kind: "nodes", value: {items: [item]}}})
            next = {...value, items}
        } else if (value.kind === "nodes") {
            const items = value.value.items.slice()
            items.splice(index, 0, item)
            next = {...value, value: {...value.value, items}}
        } else throw new Error("Insertion requires a nodes or array value")
        const candidate = updateInstanceAtPath(document, path, instance => ({...instance,
            props: {...instance.props, [propName]: {kind: "composed", value: next}}}))
        return commitDocument(document, candidate, metadata, library, callbacks)
    } catch (error) { return rejection(document, error) }
}

/** Array removal targets the array entry ID, never an inner slot item's ID. */
export function removeSlotItem(document: CompositionDocument, metadata: MetadataDocument,
    library: ComponentLibraryData, path: ValuePath, propName: string, itemId: string,
    callbacks?: CallbackRegistry): SlotOperationResult {
    return removeAtValuePath(document, metadata, library, [...path, {kind: "prop", propName}], itemId, callbacks)
}

export function moveSlotItem(document: CompositionDocument, metadata: MetadataDocument,
    library: ComponentLibraryData, path: ValuePath, propName: string, from: number, to: number,
    callbacks?: CallbackRegistry): SlotOperationResult {
    return moveAtValuePath(document, metadata, library, [...path, {kind: "prop", propName}], from, to, callbacks)
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// Component-reference picker (docs/slot-contract.md section 8's "componentRef" bullet):
// candidates restricted to the resolved policy's `accepts` list, via `checkSlotValue` - never
// a hardcoded list.
// ---------------------------------------------------------------------------------------------
export interface ComponentRefPaletteEntry {
    component: ComponentMetadata
    result: SlotCheckResult
}

export function computeComponentRefPalette(
    hostComponent: ComponentMetadata,
    propName: string,
    metadata: MetadataDocument,
    library: ComponentLibraryData
): ComponentRefPaletteEntry[] {
    const rules = resolvePropSlotRules(hostComponent, propName)
    if (rules.itemRule?.slot?.kind !== "componentRef") return []
    return metadata.components.map(component => {
        // Real bug fixed (phase 4 demo work surfaced it): this always built a project identity,
        // even for a component whose own `.external` field is set, so an external component could
        // never appear as a valid componentRef candidate regardless of its accepts-list membership.
        const identity: ComponentIdentity = component.external ?? {source: "project", id: component.id}
        return {component, result: checkSlotValue(rules.itemRule, identity, {library, currentItemCount: 0, currentNonVoidCount: 0})}
    })
}

export function setComponentRefProp(
    document: CompositionDocument,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    path: ValuePath,
    propName: string,
    identity: ComponentIdentity,
    callbacks?: CallbackRegistry
): SlotOperationResult {
    const host = getInstanceAtPath(document, path)
    const hostComponent = findHostComponent(metadata, host.componentId)
    const rules = resolvePropSlotRules(hostComponent, propName)
    if (rules.itemRule?.slot?.kind !== "componentRef")
        return {ok: false, document, reason: `"${propName}" does not resolve to a componentRef policy`, diagnostics: []}
    const result = checkSlotValue(rules.itemRule, identity, {library, currentItemCount: 0, currentNonVoidCount: 0})
    if (!result.ok) return {ok: false, document, reason: describeRejection(result), diagnostics: result.diagnostics}
    return commitDocument(document, updateInstanceAtPath(document, path, instance => ({
            ...instance,
            props: {...instance.props, [propName]: {kind: "composed", value: {kind: "componentRef", value: identity}}}
        })), metadata, library, callbacks)
}

/** Convenience re-export so a consumer only needs one import for library lookups alongside these operations. */
export {findComponentEntry}
export type {CompositionInstance}
