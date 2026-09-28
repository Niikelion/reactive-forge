import {
    checkSlotValue,
    ComponentLibraryData,
    ComponentMetadata,
    findComponentEntry,
    fromValueJson,
    MetadataDocument,
    registerCommonSchemas,
    resolveSlotPolicy,
    schemaFromJson,
    SlotCheckContext,
    SlotItemCandidate
} from "@reactive-forge/schema"
import {
    CompositionDocument,
    CompositionDocumentV1,
    CompositionInstance,
    CompositionInstanceV1,
    CompositionNodeV1,
    CompositionPropValue,
    CompositionSlotItem,
    CompositionSlotValue
} from "./composition.js"
import type {CallbackRegistry} from "./render.js"

// schemaFromJson (used below to turn a PropMetadata.schema back into a real Schema instance)
// resolves through a process-global factory registry that nothing registers by default - see
// packages/schema/src/schema/commonSchemas.ts. registerCommonSchemas() is idempotent, safe even if
// a host also calls it.
registerCommonSchemas()

/**
 * Diagnostic shape for composition-document validation. Deliberately close to `Diagnostic` in
 * packages/schema/src/schema/metadata.ts (same severity/code/message triad), but `location` (a
 * source-file position) makes no sense for a composition document - `path` (a JSON-pointer-ish
 * string identifying the offending node) replaces it.
 */
export interface CompositionDiagnostic {
    severity: "error" | "warning"
    code: string
    message: string
    path: string
}

export interface ValidationResult {
    valid: boolean
    diagnostics: CompositionDiagnostic[]
}

function findMetadata(metadata: MetadataDocument, id: string): ComponentMetadata | undefined {
    return metadata.components.find(component => component.id === id)
}

// A function-typed prop that is also optional extracts as a union of function/undefined - "is this
// prop callback-shaped" has to look inside a union, not just check the top-level type tag.
function isFunctionLike(schema: {type: string, types?: {type: string}[]}): boolean {
    if (schema.type === "function") return true
    if (schema.type === "union") return (schema.types ?? []).some(isFunctionLike)
    return false
}

// ---------------------------------------------------------------------------------------------
// Shared slot-rule resolution for a single prop path, used by both validation (below) and
// rendering (render.ts, for the Fragment-wrapping rule). docs/slot-contract.md section 2's
// each()-through-a-declared-array case and section 7's bare-ReactNode case both address the SAME
// stored `CompositionSlotValue.items` array (this package's composition model does not carry a
// separate "one items array per array-entry" nesting - see the doc comment on
// `resolvePropSlotRules` in validate.ts's own module comment above for the judgment call this
// implements). For a prop whose target schema is a declared array of ReactNode (Card's `actions`
// being the contract's own worked example), the per-item acceptance rule lives at
// `[propName, each()]`, while the array's own length bound (`collection`) lives at `[propName]`.
// For a bare ReactNode prop (no declared array, e.g. `header`), there is no `each()` step at all -
// the same rule at `[propName]` governs both the item's acceptance and (via its own
// multiple/minItems/maxItems fields) the slot's cardinality.
//
// Algorithm: try `resolveSlotPolicy(meta, [propName, {kind:"each"}])` first; if it returns a rule
// with a `slot` populated, that is the per-item rule, and `resolveSlotPolicy(meta, [propName])`'s
// `collection` (if any) bounds `items.length`. Otherwise, `resolveSlotPolicy(meta, [propName])`
// itself is the per-item rule and there is no separate collection bound.
// ---------------------------------------------------------------------------------------------
export interface PropSlotRules {
    /** The rule checked against each stored `CompositionSlotItem`/`RichTextValueJson`/`ComponentIdentity`. */
    itemRule: ReturnType<typeof resolveSlotPolicy>
    /** The array-length bound on `items.length`, when the prop is a declared array (e.g. `actions`). */
    collection?: { minItems?: number, maxItems?: number }
    /**
     * `true` when `itemRule` came from an `each()` path (a declared-array prop, e.g.
     * `["actions", each()]`) - meaning each stored `items[i]` is its OWN independent entry, each
     * with its own private cardinality budget (`items[i]` is entry `i`'s entire rendered content,
     * checked in isolation), not a shared multi-item slot. `false` for a bare ReactNode/richText/
     * componentRef path (e.g. `["header"]`), where every item in `items` competes for one shared
     * cardinality budget. This distinction matters for `checkSlotValue`'s `SlotCheckContext`
     * counts: a shared slot's items are checked cumulatively (item N sees N-1 prior siblings), an
     * each()-entry's single item is always checked alone (0 prior siblings - the entry has no
     * "siblings" of its own, only the array itself, bounded separately by `collection`).
     */
    perEntry: boolean
}

export function resolvePropSlotRules(meta: ComponentMetadata, propName: string): PropSlotRules {
    const eachRule = resolveSlotPolicy(meta, [propName, {kind: "each"}])
    if (eachRule?.slot !== undefined) {
        const topRule = resolveSlotPolicy(meta, [propName])
        return {itemRule: eachRule, collection: topRule?.collection, perEntry: true}
    }
    return {itemRule: resolveSlotPolicy(meta, [propName]), perEntry: false}
}

// Effective minItems for a policy, mirroring docs/slot-contract.md section 3's cardinality
// formulas (the schema package's own equivalent, `resolveCardinality` in SlotCheck.ts, is a
// private, unexported helper - this is a small, deliberate local reimplementation of just the
// `minItems` half, which `checkSlotValue` itself never enforces per-item; see the doc comment on
// `validateSlotValue` below for why the caller has to do this part).
function effectiveMinItems(policy: {kind: string, minItems?: number}): number {
    return policy.minItems ?? 0
}

function toSlotCheckCandidate(item: CompositionSlotItem): SlotItemCandidate {
    return item
}

function validateSlotValue(
    propName: string,
    slotValue: CompositionSlotValue,
    rules: PropSlotRules,
    path: string,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry | undefined,
    diagnostics: CompositionDiagnostic[]
): void {
    const {itemRule, collection, perEntry} = rules

    if (collection !== undefined) {
        if (collection.maxItems !== undefined && slotValue.items.length > collection.maxItems)
            diagnostics.push({severity: "error", code: "collection-max-items-exceeded", message: `"${propName}" holds ${String(slotValue.items.length)} entries; collection maxItems is ${String(collection.maxItems)}`, path})
        if (collection.minItems !== undefined && slotValue.items.length < collection.minItems)
            diagnostics.push({severity: "error", code: "collection-min-items-not-met", message: `"${propName}" holds ${String(slotValue.items.length)} entries; collection minItems is ${String(collection.minItems)}`, path})
    }

    let nonVoidCount = 0
    slotValue.items.forEach((item, index) => {
        const itemPath = `${path}.items[${String(index)}]`
        // perEntry: each item is its own independent entry (0 prior siblings, always). Shared
        // slot: items compete cumulatively for one budget (item N sees N prior siblings).
        const context: SlotCheckContext = perEntry
            ? {library, currentItemCount: 0, currentNonVoidCount: 0}
            : {library, currentItemCount: index, currentNonVoidCount: nonVoidCount}
        const result = checkSlotValue(itemRule, toSlotCheckCandidate(item), context)
        if (!result.ok) {
            for (const d of result.diagnostics)
                diagnostics.push({severity: d.severity, code: d.code, message: d.message, path: itemPath})
        }
        if (perEntry && itemRule?.slot !== undefined) {
            const minItems = effectiveMinItems(itemRule.slot)
            if (minItems > 0 && item.kind === "void")
                diagnostics.push({severity: "error", code: "slot-min-items-not-met", message: `Entry ${String(index)} of "${propName}" is void; this entry's minItems is ${String(minItems)}`, path: itemPath})
        }
        if (item.kind !== "void") nonVoidCount++
        if (item.kind === "instance")
            validateInstance(item.instance, `${itemPath}.instance`, metadata, library, callbacks, diagnostics)
    })

    if (!perEntry && itemRule?.slot !== undefined) {
        const minItems = effectiveMinItems(itemRule.slot)
        if (minItems > 0 && nonVoidCount < minItems)
            diagnostics.push({severity: "error", code: "slot-min-items-not-met", message: `"${propName}" holds ${String(nonVoidCount)} non-void item(s); minItems is ${String(minItems)}`, path})
    }
}

function validateInstance(
    node: CompositionInstance,
    path: string,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry | undefined,
    diagnostics: CompositionDiagnostic[]
): void {
    const componentMeta = findMetadata(metadata, node.componentId)
    if (componentMeta === undefined) {
        diagnostics.push({severity: "error", code: "unknown-component-id", message: `No component with id "${node.componentId}" in the metadata document`, path})
        return
    }
    const entry = findComponentEntry(library, node.componentId)
    if (entry === undefined) {
        diagnostics.push({severity: "error", code: "component-not-registered", message: `No registry entry with id "${node.componentId}" for component "${componentMeta.name}" (${componentMeta.sourcePath})`, path})
        return
    }

    for (const [propName, propMeta] of Object.entries(componentMeta.props)) {
        const provided = node.props[propName]
        const rules = resolvePropSlotRules(componentMeta, propName)
        const isSlotDomain = rules.itemRule !== undefined

        if (provided === undefined) {
            if (propMeta.required)
                diagnostics.push({severity: "error", code: "missing-required-prop", message: `Required prop "${propName}" is missing`, path: `${path}.props.${propName}`})
            else if (isSlotDomain && rules.itemRule?.slot !== undefined && effectiveMinItems(rules.itemRule.slot) > 0)
                diagnostics.push({severity: "error", code: "slot-min-items-not-met", message: `"${propName}" is missing but this slot's minItems is ${String(effectiveMinItems(rules.itemRule.slot))}`, path: `${path}.props.${propName}`})
            continue
        }

        const propPath = `${path}.props.${propName}`

        if (provided.kind === "nodes") {
            if (!isSlotDomain) {
                diagnostics.push({severity: "error", code: "unexpected-slot-value", message: `Prop "${propName}" is not a ReactNode-domain slot`, path: propPath})
                continue
            }
            validateSlotValue(propName, provided.value, rules, propPath, metadata, library, callbacks, diagnostics)
            continue
        }

        if (provided.kind === "richText") {
            if (rules.itemRule?.slot?.kind !== "richText") {
                diagnostics.push({severity: "error", code: "policy-type-mismatch", message: `Prop "${propName}" does not resolve to a richText policy`, path: propPath})
                continue
            }
            const result = checkSlotValue(rules.itemRule, provided.value, {library, currentItemCount: 0, currentNonVoidCount: 0})
            if (!result.ok)
                for (const d of result.diagnostics) diagnostics.push({severity: d.severity, code: d.code, message: d.message, path: propPath})
            continue
        }

        if (provided.kind === "componentRef") {
            if (rules.itemRule?.slot?.kind !== "componentRef") {
                diagnostics.push({severity: "error", code: "policy-type-mismatch", message: `Prop "${propName}" does not resolve to a componentRef policy`, path: propPath})
                continue
            }
            const result = checkSlotValue(rules.itemRule, provided.value, {library, currentItemCount: 0, currentNonVoidCount: 0})
            if (!result.ok)
                for (const d of result.diagnostics) diagnostics.push({severity: d.severity, code: d.code, message: d.message, path: propPath})
            continue
        }

        if (isSlotDomain) {
            diagnostics.push({severity: "error", code: "unexpected-value-kind", message: `Prop "${propName}" is a slot; expected a "nodes"/"richText"/"componentRef" value`, path: propPath})
            continue
        }

        if (provided.kind === "callback") {
            if (!isFunctionLike(propMeta.schema)) {
                diagnostics.push({severity: "error", code: "callback-for-non-function-prop", message: `Prop "${propName}" is not function-typed and cannot take a callback reference`, path: propPath})
                continue
            }
            if (callbacks !== undefined && !(provided.name in callbacks)) {
                diagnostics.push({severity: "error", code: "unresolved-callback", message: `Callback reference "${provided.name}" for prop "${propName}" is not present in the host callback registry`, path: propPath})
            }
            continue
        }

        // provided.kind === "value"
        try {
            const schema = schemaFromJson(propMeta.schema)
            fromValueJson(schema, provided.value)
        } catch (error) {
            diagnostics.push({severity: "error", code: "invalid-prop-value", message: `Prop "${propName}": ${error instanceof Error ? error.message : String(error)}`, path: propPath})
        }
    }

    for (const propName of Object.keys(node.props)) {
        if (!(propName in componentMeta.props))
            diagnostics.push({severity: "warning", code: "unknown-prop", message: `Prop "${propName}" is not declared on component "${componentMeta.name}"`, path: `${path}.props.${propName}`})
    }
}

/**
 * Validates a v2 composition document against a `MetadataDocument` (for prop schemas/slot
 * policies/requiredness) and a `ComponentLibraryData` (for actual component registration). Checks,
 * recursively over the whole tree:
 *
 * - `doc.schemaVersion` is exactly `2` - a `1` (or any other) document is refused outright with
 *   diagnostic `"unsupported-schema-version"` naming `migrateCompositionDocumentV1ToV2` (for `1`)
 *   as the required step, per docs/slot-contract.md section 10. This function never branches on
 *   `schemaVersion === 1` to reinterpret the old sibling-`children` structure.
 * - every referenced component id exists in both the metadata document and the registry;
 * - every ordinary (`"value"`/`"callback"`) prop value is assignable/resolvable exactly as v1
 *   checked it;
 * - every `"nodes"`/`"richText"`/`"componentRef"` prop value is checked through the SAME
 *   `resolveSlotPolicy`/`checkSlotValue` pair the editor's palette/drop-acceptance code will use in
 *   phase 3 (docs/slot-contract.md section 8) - not a parallel ad-hoc check. See
 *   `resolvePropSlotRules` above for exactly how a prop's path is built for that lookup.
 * - every required prop (including a required-by-`minItems` slot) is present.
 *
 * Never throws; returns a structured result. `renderComposition` in render.ts calls this with the
 * real callback registry and throws `CompositionValidationError` if the result is invalid.
 */
export function validateComposition(
    doc: CompositionDocument | CompositionDocumentV1,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks?: CallbackRegistry
): ValidationResult {
    const diagnostics: CompositionDiagnostic[] = []
    const schemaVersion: number = doc.schemaVersion
    if (schemaVersion === 1) {
        diagnostics.push({severity: "error", code: "unsupported-schema-version", message: `Composition schemaVersion 1 is not accepted by v2 APIs; call migrateCompositionDocumentV1ToV2(doc) first`, path: "root"})
        return {valid: false, diagnostics}
    }
    if (schemaVersion !== 2) {
        diagnostics.push({severity: "error", code: "unsupported-schema-version", message: `Unsupported composition schemaVersion: ${String(schemaVersion)}`, path: "root"})
        return {valid: false, diagnostics}
    }
    validateInstance((doc as CompositionDocument).root, "root", metadata, library, callbacks, diagnostics)
    return {valid: !diagnostics.some(d => d.severity === "error"), diagnostics}
}

// ---------------------------------------------------------------------------------------------
// Migration, docs/slot-contract.md section 10 ("Composition document: v1 -> v2 requires an
// explicit migration call"). Deterministic, reproducible, idempotent id synthesis from each v1
// node's structural position (the same childIndexPath packages/editor/src/preview.ts's
// `CompositionPath` already used: `[]` = root, `[0]` = root's first child, etc).
// ---------------------------------------------------------------------------------------------

// Small, dependency-free FNV-1a 32-bit hash, hex-encoded - reimplemented locally rather than
// depending on packages/codegen/src/hash.ts's `shortHash` (same algorithm), per the phase-2
// handoff's explicit architecture boundary: packages/runtime must not start depending on
// packages/codegen (compiler tooling stays codegen-only). Not cryptographic; only needs to be
// stable across runs for the small "migrated\0<childIndexPath>" input space this function produces.
function shortHash(input: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
}

function migratedInstanceId(childIndexPath: number[]): string {
    return shortHash(`migrated\0${childIndexPath.join(".")}`)
}

// itemId is a distinct id from the instance's own instanceId (an "instance"-kind slot item wraps
// an instance that already has its own instanceId) - salted with a literal tag so the two never
// collide for the same structural position. Not specified verbatim by the contract (which only
// gives the instanceId formula); a documented, deterministic, reproducible judgment call.
function migratedItemId(childIndexPath: number[]): string {
    return shortHash(`migrated-item\0${childIndexPath.join(".")}`)
}

function migrateNodeToSlotItem(node: CompositionNodeV1, childIndexPath: number[]): CompositionSlotItem {
    const itemId = migratedItemId(childIndexPath)
    if (node.kind === "text") return {itemId, kind: "text", value: node.value}
    if (node.kind === "void") return {itemId, kind: "void"}
    return {itemId, kind: "instance", instance: migrateInstance(node, childIndexPath)}
}

function migrateInstance(node: CompositionInstanceV1, childIndexPath: number[]): CompositionInstance {
    const props: Record<string, CompositionPropValue> = {}
    for (const [propName, propValue] of Object.entries(node.props)) {
        // Every existing {kind:"value"}/{kind:"callback"} prop value passes through unchanged -
        // both kinds are still valid CompositionPropValue variants in v2 (section 10).
        props[propName] = propValue
    }
    if (node.children !== undefined && node.children.length > 0) {
        props["children"] = {
            kind: "nodes",
            value: {items: node.children.map((child, index) => migrateNodeToSlotItem(child, [...childIndexPath, index]))}
        }
    }
    return {
        kind: "instance",
        instanceId: migratedInstanceId(childIndexPath),
        componentId: node.id,
        props
    }
}

/**
 * v1 -> v2 composition document upgrade, docs/slot-contract.md section 10, implemented verbatim:
 *
 * - assigns `instanceId`/`itemId` deterministically from each node's v1 structural position
 *   (`instanceId = shortHash("migrated\0" + childIndexPath.join("."))`);
 * - rewrites `id` -> `componentId` on every instance;
 * - converts the old sibling `children?: CompositionNodeV1[]` into
 *   `props["children"] = {kind: "nodes", value: {items: children.map(toSlotItem)}}`;
 * - every existing `{kind:"value"}`/`{kind:"callback"}` prop value passes through unchanged.
 *
 * Deterministic and reproducible: the same v1 document always migrates to the same v2 ids, and
 * re-running migration on an already-migrated-then-reloaded v1 document (impossible in practice
 * since a migrated document is `schemaVersion: 2`, but structurally) would produce the same ids
 * again. This is a one-time synthesis only - v2 documents never recompute ids from position again.
 */
export function migrateCompositionDocumentV1ToV2(doc: CompositionDocumentV1): CompositionDocument {
    return {schemaVersion: 2, root: migrateInstance(doc.root, [])}
}
