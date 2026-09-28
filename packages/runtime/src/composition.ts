import type {ComponentIdentity, RichTextValueJson, ValueJson} from "@reactive-forge/schema"

// Composition document contract, v2 (docs/slot-contract.md section 7, replacing the v1 shape gate
// D, part 1 introduced - see docs/development-plan.md point 4 for the original v1 rationale, kept
// below as the `...V1` types for migration/reference).
//
// VERSIONING/NAMING DECISION (per the phase-2 handoff, item 1): the plain, unsuffixed names
// (`CompositionDocument`, `CompositionInstance`, `CompositionPropValue`) are REPURPOSED to mean the
// v2 shape from this point forward - matching `packages/schema/src/schema/metadata.ts`'s own
// `MetadataDocumentV1`/`MetadataDocumentV2` precedent (the v1 shape there is the suffixed one, the
// unsuffixed `MetadataDocument` name already meant "whatever the current contract version is"). The
// old v1 shape is kept, unchanged, under `CompositionDocumentV1`/`CompositionInstanceV1`/
// `CompositionNodeV1`/`CompositionTextV1`/`CompositionVoidV1`/`CompositionPropValueV1` purely so
// `migrateCompositionDocumentV1ToV2` (validate.ts) has a real input type to document against; no
// other function in this package accepts the V1 shape.
//
// BLAST RADIUS (see the report handed back to the coordinator): `packages/editor/src/preview.ts`
// and `packages/runtime/src/export.ts` both import the plain names and consume the v1 field shape
// directly (`node.id`, `node.children`, `CompositionPropValue`'s two-variant union with no `kind`
// discriminant guard for the three new variants). Repurposing the names means those two files no
// longer type-check against the new exports, and - since this repo's tests run through a
// transpile-only loader (tests/source-loader.cjs), not real type-checking - their existing tests
// keep *running* but exercise the wrong fields at runtime (`node.id` is now `undefined` on a v2
// instance, `node.children` is not a field on `CompositionInstance` at all) and will fail with
// wrong output rather than a compile error. This is a real, expected integration cost for phase 3
// to resolve (out of this file's ownership) - not something this file works around.

/**
 * A single prop value slot on a v2 composition instance. Two kinds unchanged from v1
 * (`"value"`/`"callback"`), plus three new kinds per docs/slot-contract.md section 7:
 *
 * - `"componentRef"`: a `React.ComponentType<Props>` prop - a `ComponentIdentity`, resolved
 *   through the registry at render time and passed as the *raw constructor*, never wrapped in
 *   `createElement`/invoked (contract section 9).
 * - `"richText"`: a `richText`-policy `ReactNode` prop - a closed, small node/mark tree (see
 *   `RichTextValueJson` in `@reactive-forge/schema`), rendered through one fixed, non-overridable
 *   mapping (`renderRichText` in render.ts).
 * - `"nodes"`: an `any`/`components`-policy `ReactNode` prop, INCLUDING `children` - v2 has no
 *   special sibling `children` field at all (see "children is no longer a special sibling field"
 *   below); a component's `children` prop is addressed and stored exactly like any other
 *   `ReactNode`-domain prop, `props["children"] = {kind: "nodes", value: {items: [...]}}`.
 */
export type CompositionPropValue =
    | { kind: "value", value: ValueJson }
    | { kind: "callback", name: string }
    | { kind: "componentRef", value: ComponentIdentity }
    | { kind: "richText", value: RichTextValueJson }
    | { kind: "nodes", value: CompositionSlotValue }

/**
 * v2 composition instance. `instanceId`/`componentId` split (docs/slot-contract.md section 7):
 * `instanceId` is a stable, editor-generated, persisted per-instance identity (opaque string,
 * never recomputed from position); `componentId` is what v1 called `id` - which registered
 * component this instance renders, looked up in both the `MetadataDocument` and the
 * `ComponentLibraryData` exactly as v1's `id` was.
 */
export interface CompositionInstance {
    kind: "instance"
    instanceId: string
    componentId: string
    props: Record<string, CompositionPropValue>
}

/**
 * An ordered, addressable list of slot items - the value of any `"nodes"`-kind
 * `CompositionPropValue`. Order is render/display order; reordering `items` is a pure array splice
 * that carries each item's `itemId` (and, for instance items, that instance's own `instanceId`)
 * along with it, so identity never depends on array position (docs/slot-contract.md section 7).
 */
export interface CompositionSlotValue {
    items: CompositionSlotItem[]
}

/**
 * One item in a `CompositionSlotValue.items` array. `itemId` is the same kind of opaque,
 * editor-generated, persisted string as `CompositionInstance.instanceId` - stable per array-item
 * identity, unique within its enclosing `items` array.
 *
 * `"void"` is kept as an explicit, addressable "empty slot item" distinct from omitting an item
 * from `items` entirely - it still counts toward `items.length` for `maxItems` purposes but never
 * toward a `minItems`/required check (docs/slot-contract.md section 7, "CompositionSlotItem.kind:
 * void").
 */
export type CompositionSlotItem =
    | { itemId: string, kind: "instance", instance: CompositionInstance }
    | { itemId: string, kind: "text", value: string }
    | { itemId: string, kind: "void" }

/**
 * v2 composition document. `schemaVersion: 2` only - a bare `schemaVersion: 1` document is a
 * different type (`CompositionDocumentV1`, below) and must go through
 * `migrateCompositionDocumentV1ToV2` (validate.ts) before it is a `CompositionDocument`.
 * `validateComposition`/`renderComposition` accept `CompositionDocument | CompositionDocumentV1`
 * at the type level specifically so they can inspect `schemaVersion` at runtime and produce the
 * `"unsupported-schema-version"` diagnostic (never silently reinterpreting v1 structure) rather
 * than refusing to compile against a real on-disk v1 document.
 *
 * Root identity: `root` is a `CompositionInstance` like any other, with its own `instanceId` - no
 * special-cased "root has no id" exception (docs/slot-contract.md section 7, "Root identity").
 */
export interface CompositionDocument {
    schemaVersion: 2
    root: CompositionInstance
}

// ---------------------------------------------------------------------------------------------
// v1 shapes (unchanged from the original gate-D implementation), kept only as
// `migrateCompositionDocumentV1ToV2`'s documented input type. Nothing else in this package
// constructs or consumes these.
// ---------------------------------------------------------------------------------------------

export type CompositionPropValueV1 =
    | { kind: "value", value: ValueJson }
    | { kind: "callback", name: string }

export type CompositionNodeV1 = CompositionInstanceV1 | CompositionTextV1 | CompositionVoidV1

export interface CompositionInstanceV1 {
    kind: "instance"
    id: string
    props: Record<string, CompositionPropValueV1>
    children?: CompositionNodeV1[]
}

export interface CompositionTextV1 {
    kind: "text"
    value: string
}

export interface CompositionVoidV1 {
    kind: "void"
}

export interface CompositionDocumentV1 {
    schemaVersion: 1
    root: CompositionInstanceV1
}
