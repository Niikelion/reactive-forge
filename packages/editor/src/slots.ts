import {
    checkSlotValue,
    ComponentIdentity,
    ComponentLibraryData,
    ComponentMetadata,
    Diagnostic,
    findComponentEntry,
    MetadataDocument,
    RichTextMark,
    RichTextValueJson,
    SlotCheckContext,
    SlotCheckResult,
    SlotItemCandidate
} from "@reactive-forge/schema"
import {CompositionDocument, CompositionInstance, CompositionSlotItem, resolvePropSlotRules} from "@reactive-forge/runtime"
import {getInstanceAtPath, InstancePath, updateInstanceAtPath} from "./preview.js"

// Slot outlets and operations, phase 3 (docs/slot-contract.md section 8: "One shared
// policy resolver/validator must serve palette filtering, drop acceptance, paste/
// insertion, document loading, rendering, and export preflight"). Every function here
// that decides whether something is allowed calls `checkSlotValue`/`resolveSlotPolicy`
// - the SAME functions `packages/runtime/src/validate.ts` already uses to validate a
// whole document - never a parallel ad-hoc check. This module only adds: candidate
// enumeration (the palette/picker lists), id generation for new items, and the
// insert/remove/reorder array operations themselves.

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

function slotCheckContextFor(
    items: CompositionSlotItem[],
    index: number,
    perEntry: boolean,
    library: ComponentLibraryData
): SlotCheckContext {
    if (perEntry) return {library, currentItemCount: 0, currentNonVoidCount: 0}
    const before = items.slice(0, index)
    return {
        library,
        currentItemCount: before.length,
        currentNonVoidCount: before.filter(i => i.kind !== "void").length
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
    const context = slotCheckContextFor(currentItems, insertAtIndex, rules.perEntry, library)
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

/**
 * Inserts `item` into the `"nodes"` slot `propName` on the instance at `path`, at
 * `insertAtIndex`. Checked via `checkSlotValue` against the SAME resolved policy
 * `computeInsertablePalette`/`validateComposition` use, before the document is touched at
 * all - a rejected candidate never mutates `document` (the returned `document` is `===`
 * the input on rejection) and carries a human-readable `reason` plus the raw diagnostics.
 */
export function insertSlotItem(
    document: CompositionDocument,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    path: InstancePath,
    propName: string,
    insertAtIndex: number,
    item: CompositionSlotItem
): SlotOperationResult {
    const host = getInstanceAtPath(document, path)
    const hostComponent = findHostComponent(metadata, host.componentId)
    const prop = host.props[propName]
    const currentItems: CompositionSlotItem[] = prop?.kind === "nodes" ? prop.value.items : []

    const rules = resolvePropSlotRules(hostComponent, propName)
    if (rules.itemRule?.slot === undefined)
        return {ok: false, document, reason: `"${propName}" is not a nodes-kind slot on "${hostComponent.name}"`, diagnostics: []}

    if (rules.collection?.maxItems !== undefined && currentItems.length + 1 > rules.collection.maxItems) {
        return {
            ok: false,
            document,
            reason: `"${propName}" already holds ${String(currentItems.length)} entries; collection maxItems is ${String(rules.collection.maxItems)}`,
            diagnostics: []
        }
    }

    const candidate: SlotItemCandidate = item
    const context = slotCheckContextFor(currentItems, insertAtIndex, rules.perEntry, library)
    const result = checkSlotValue(rules.itemRule, candidate, context)
    if (!result.ok) return {ok: false, document, reason: describeRejection(result), diagnostics: result.diagnostics}

    const nextItems = currentItems.slice()
    nextItems.splice(insertAtIndex, 0, item)
    const nextDocument = updateInstanceAtPath(document, path, instance => ({
        ...instance,
        props: {...instance.props, [propName]: {kind: "nodes", value: {items: nextItems}}}
    }))
    return {ok: true, document: nextDocument}
}

/** Removes the item with `itemId` from the `"nodes"` slot `propName`. A no-op (same document) if not found. */
export function removeSlotItem(
    document: CompositionDocument,
    path: InstancePath,
    propName: string,
    itemId: string
): CompositionDocument {
    const host = getInstanceAtPath(document, path)
    const prop = host.props[propName]
    if (prop?.kind !== "nodes") return document
    const nextItems = prop.value.items.filter(i => i.itemId !== itemId)
    if (nextItems.length === prop.value.items.length) return document
    return updateInstanceAtPath(document, path, instance => ({
        ...instance,
        props: {...instance.props, [propName]: {kind: "nodes", value: {items: nextItems}}}
    }))
}

/**
 * Reorders the `"nodes"` slot `propName`: moves the item currently at `fromIndex` to
 * `toIndex` (array splice). Every item's `itemId` (and, for an `"instance"` item, that
 * instance's own `instanceId`) is carried along unchanged - reordering never touches
 * identity, only position, which is the entire point of id-based addressing (`InstancePath`
 * steps re-resolve by `itemId`, so any path into a *moved* item's own subtree stays valid
 * across the move).
 */
export function moveSlotItem(
    document: CompositionDocument,
    path: InstancePath,
    propName: string,
    fromIndex: number,
    toIndex: number
): CompositionDocument {
    const host = getInstanceAtPath(document, path)
    const prop = host.props[propName]
    if (prop?.kind !== "nodes") return document
    const items = prop.value.items
    if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex)
        return document
    const nextItems = items.slice()
    const [moved] = nextItems.splice(fromIndex, 1)
    if (moved === undefined) return document
    nextItems.splice(toIndex, 0, moved)
    return updateInstanceAtPath(document, path, instance => ({
        ...instance,
        props: {...instance.props, [propName]: {kind: "nodes", value: {items: nextItems}}}
    }))
}

// ---------------------------------------------------------------------------------------------
// Rich text editing (docs/slot-contract.md section 8's "richText" bullet). No WYSIWYG editor -
// a minimal toggle-a-mark-on-the-whole-value operation, still producing a real,
// checkSlotValue-validated RichTextValueJson and rejecting a disallowed mark per the target
// RichTextPolicy.marks.
// ---------------------------------------------------------------------------------------------
export function plainRichText(text: string, inline: boolean): RichTextValueJson {
    if (inline) return {kind: "richText", version: 1, inline: true, nodes: [{type: "text", text, marks: []}]}
    return {
        kind: "richText",
        version: 1,
        inline: false,
        nodes: [{type: "paragraph", children: [{type: "text", text, marks: []}]}]
    }
}

function toggleMarkOnTextNode<T extends {marks: RichTextMark[]}>(node: T, mark: RichTextMark): T {
    const has = node.marks.includes(mark)
    return {...node, marks: has ? node.marks.filter(m => m !== mark) : [...node.marks, mark]}
}

/** Toggles `mark` on every text run in `value` (all-or-nothing: on if any run lacked it, per typical rich-text toggle UX is "on" when not already uniformly on). */
export function toggleRichTextMark(value: RichTextValueJson, mark: RichTextMark): RichTextValueJson {
    if (value.inline) return {...value, nodes: value.nodes.map(n => toggleMarkOnTextNode(n, mark))}
    return {
        ...value,
        nodes: value.nodes.map(block => {
            if (block.type === "paragraph") return {...block, children: block.children.map(n => toggleMarkOnTextNode(n, mark))}
            return {
                ...block,
                items: block.items.map(item => ({...item, children: item.children.map(n => toggleMarkOnTextNode(n, mark))}))
            }
        })
    }
}

/** Sets the text content of `value` (inline single-run case; used by the demo's plain textarea editing). */
export function setRichTextContent(value: RichTextValueJson, text: string): RichTextValueJson {
    if (value.inline) {
        const first = value.nodes[0]
        return {...value, nodes: [{type: "text", text, marks: first?.marks ?? []}]}
    }
    const firstBlock = value.nodes[0]
    const firstMarks = firstBlock?.type === "paragraph" ? firstBlock.children[0]?.marks ?? [] : []
    return {...value, nodes: [{type: "paragraph", children: [{type: "text", text, marks: firstMarks}]}]}
}

/** Validates a candidate `RichTextValueJson` for prop `propName` on `hostComponent`, via `checkSlotValue` against the same resolved policy validation uses. */
export function checkRichTextValue(
    hostComponent: ComponentMetadata,
    propName: string,
    library: ComponentLibraryData,
    candidate: RichTextValueJson
): SlotCheckResult {
    const rules = resolvePropSlotRules(hostComponent, propName)
    if (rules.itemRule?.slot?.kind !== "richText")
        return {ok: false, diagnostics: [{severity: "error", code: "policy-type-mismatch", message: `"${propName}" does not resolve to a richText policy`}]}
    return checkSlotValue(rules.itemRule, candidate, {library, currentItemCount: 0, currentNonVoidCount: 0})
}

/** Sets a `"richText"`-kind prop value on the instance at `path`, only if it passes `checkRichTextValue`; unchanged document + reason on rejection. */
export function setRichTextProp(
    document: CompositionDocument,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    path: InstancePath,
    propName: string,
    value: RichTextValueJson
): SlotOperationResult {
    const host = getInstanceAtPath(document, path)
    const hostComponent = findHostComponent(metadata, host.componentId)
    const result = checkRichTextValue(hostComponent, propName, library, value)
    if (!result.ok) return {ok: false, document, reason: describeRejection(result), diagnostics: result.diagnostics}
    return {
        ok: true,
        document: updateInstanceAtPath(document, path, instance => ({
            ...instance,
            props: {...instance.props, [propName]: {kind: "richText", value}}
        }))
    }
}

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
        const identity: ComponentIdentity = {source: "project", id: component.id}
        return {component, result: checkSlotValue(rules.itemRule, identity, {library, currentItemCount: 0, currentNonVoidCount: 0})}
    })
}

export function setComponentRefProp(
    document: CompositionDocument,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    path: InstancePath,
    propName: string,
    identity: ComponentIdentity
): SlotOperationResult {
    const host = getInstanceAtPath(document, path)
    const hostComponent = findHostComponent(metadata, host.componentId)
    const rules = resolvePropSlotRules(hostComponent, propName)
    if (rules.itemRule?.slot?.kind !== "componentRef")
        return {ok: false, document, reason: `"${propName}" does not resolve to a componentRef policy`, diagnostics: []}
    const result = checkSlotValue(rules.itemRule, identity, {library, currentItemCount: 0, currentNonVoidCount: 0})
    if (!result.ok) return {ok: false, document, reason: describeRejection(result), diagnostics: result.diagnostics}
    return {
        ok: true,
        document: updateInstanceAtPath(document, path, instance => ({
            ...instance,
            props: {...instance.props, [propName]: {kind: "componentRef", value: identity}}
        }))
    }
}

/** Convenience re-export so a consumer only needs one import for library lookups alongside these operations. */
export {findComponentEntry}
export type {CompositionInstance}
