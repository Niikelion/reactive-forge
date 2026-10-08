import type {ComponentIdentity, SchemaJson, ValueJson, VariantLiteral} from "@reactive-forge/schema"

/** Historical payload, retained only as input to explicit legacy migrations. */
interface RichTextValueJson {kind: "richText", version: 1, inline: boolean, nodes: unknown[]}

// Composition document contract, v3 (docs/slot-contract-recursive.md), extending the v2 shape
// docs/slot-contract.md section 7 introduced. See docs/slot-contract-recursive.md section 7.1.
//
// VERSIONING/NAMING DECISION (per docs/slot-contract-recursive.md section 7.1, applying the SAME
// precedent this file's own v1->v2 comment already documented a second time): the plain,
// unsuffixed names (`CompositionDocument`, `CompositionInstance`, `CompositionPropValue`) are
// REPURPOSED again, now to mean the v3 shape. The v2 shape is kept, unchanged, under
// `CompositionDocumentV2`/`CompositionInstanceV2`/`CompositionPropValueV2` purely so
// `migrateCompositionDocumentV2ToV3` (validate.ts) has a real input type to document against, and
// so any straggling v2-shaped call site can still reference the old shape explicitly. No function
// in this package other than that migration accepts the V2 shape.
//
// `CompositionSlotValue`/`CompositionSlotItem` are BYTE-IDENTICAL to their v2 definitions
// (docs/slot-contract-recursive.md section 1.1's explicit instruction) — they already correctly
// express "an ordered, independently-identified list of rendered nodes" regardless of how deep in
// the tree a `"nodes"` position sits; nothing about their own shape needed to change.
//
// BLAST RADIUS (unchanged in kind from the v1->v2 transition, now v2->v3): `packages/editor/src/
// preview.ts` and `packages/editor/src/slots.ts` both import the plain names and consume the v2
// field shape directly (`CompositionPropValue`'s five-variant union with a `"value"` kind that no
// longer exists on the v3 type, `InstancePath`'s reliance on the old flat prop-value shape). Since
// this repo's tests run through a transpile-only loader (tests/source-loader.cjs), not real
// type-checking, `packages/editor`'s existing tests keep *running* but exercise the wrong fields at
// runtime. This is expected, real integration cost for the next worker (addressing generalization,
// docs/slot-contract-recursive.md section 3) to resolve — not something this file works around.

/**
 * A value at some resolved `SlotPath` inside a v3 composition document — the recursive value model,
 * docs/slot-contract-recursive.md section 1.1. Every kind is an explicit, self-describing
 * discriminant: a reader never infers structure from what's inside a node, it reads `kind` and
 * knows immediately how to recurse.
 */
export type CompositionValue =
    | { kind: "prop", name: string }
    // Ordinary, non-slot-domain content. Serializes through the existing, UNCHANGED
    // ValueJson/fromValueJson — primitives, plain objects, plain arrays, dates, etc. A "leaf" node
    // is a claim: "resolvePath at this exact SlotPath is not ReactNode/ComponentType domain, and
    // nothing inside this ValueJson is either." Validation enforces that claim (validate.ts).
    | { kind: "leaf", value: ValueJson }

    // A nested plain object whose subtree may contain slot content at some field. Only ever valid
    // where resolvePath resolves to an ObjectSchema.
    | { kind: "object", fields: Record<string, CompositionValue> }

    // A declared array (`resolvePath` resolves to an ArraySchema). Each entry is independently
    // identified (`CompositionArrayItem`) and independently a full `CompositionValue`.
    | { kind: "array", items: CompositionArrayItem[] }

    // A union member has been selected. `selector` names the SAME variant discriminant
    // `resolveVariantSegment` (SlotPath.ts) already uses. No id: a variant position has exactly one
    // live child; selecting a different member REPLACES this whole node (section 1.5).
    | { kind: "variant", selector: { prop: string, equals: VariantLiteral }, value: CompositionValue }

    // The three existing slot-domain leaf kinds, UNCHANGED in their own inner shape from v2 — only
    // their position in the tree generalizes (any depth, not just top-level prop).
    | { kind: "componentRef", value: ComponentIdentity }
    | { kind: "nodes", value: CompositionSlotValue }

    // A value computed from the document's public props and locals (schemaVersion 6,
    // docs/composition-expressions.md). Never sits at a slot-domain path.
    | { kind: "expression", expression: CompositionExpression }

/** Binary operators an expression may use. Equality is strict. */
export type CompositionBinaryOp = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||" | "??"

/**
 * A portable, side-effect-free computation over a document's public props and locals
 * (docs/composition-expressions.md). There are no function calls, and nothing outside the
 * document is reachable.
 */
export type CompositionExpression =
    | { kind: "literal", value: ValueJson }
    | { kind: "prop", name: string }
    | { kind: "local", name: string }
    | { kind: "get", object: CompositionExpression, key: string }
    | { kind: "object", fields: Record<string, CompositionExpression> }
    | { kind: "if", condition: CompositionExpression, then: CompositionExpression, else: CompositionExpression }
    | { kind: "match", input: CompositionExpression, cases: Record<string, CompositionExpression>, fallback?: CompositionExpression }
    | { kind: "binary", op: CompositionBinaryOp, left: CompositionExpression, right: CompositionExpression }
    | { kind: "unary", op: "!" | "-", value: CompositionExpression }
    // A call to a pure function the host registered in `ComponentLibraryData.functions`.
    | { kind: "call", function: string, args: CompositionExpression[] }

/** A named value a schemaVersion 6 document computes once; its expressions may refer to it. */
export interface CompositionLocal {
    expression: CompositionExpression
    description?: string
}

/**
 * One array entry, docs/slot-contract-recursive.md section 1.3 — the type that makes "one declared
 * array entry" and "how many rendered nodes that one entry's ReactNode holds" independently
 * nestable concerns, closing the v2 flat-array gap. `itemId` is the same opaque, editor-generated,
 * persisted identity concept as `CompositionSlotItem.itemId` (section 4: one unified id concept,
 * not two) — unique within its own enclosing `items` array, never recomputed from position.
 */
export interface CompositionArrayItem {
    itemId: string
    value: CompositionValue
}

/**
 * A single prop value on a v3 composition instance — collapsed from v2's four top-level kinds
 * (`value`/`componentRef`/`richText`/`nodes`) to two, docs/slot-contract-recursive.md section 1.2:
 * `"callback"` stays a sibling (never slot-domain, never nested — a function prop has no schema-tree
 * position below it), and everything path-addressable becomes `{kind: "composed", value:
 * CompositionValue}` — a prop's top-level value is just `CompositionValue` at `SlotPath =
 * [propName]`, so a single recursive walker validates/renders/exports a prop's value AND everything
 * nested inside it uniformly.
 */
export type CompositionPropValue =
    | { kind: "prop", name: string }
    | { kind: "callback", name: string }
    | { kind: "composed", value: CompositionValue }

/**
 * v3 composition instance. `instanceId`/`componentId` split unchanged from v2.
 */
export interface CompositionInstance {
    kind: "instance"
    instanceId: string
    componentId: string
    props: Record<string, CompositionPropValue>
}

/**
 * An ordered, addressable list of slot items — the value of any `"nodes"`-kind `CompositionValue`.
 * BYTE-IDENTICAL to v2 (docs/slot-contract-recursive.md section 1.1) — order is render/display
 * order; reordering `items` is a pure array splice carrying each item's `itemId` (and, for instance
 * items, that instance's own `instanceId`) along with it.
 */
export interface CompositionSlotValue {
    items: CompositionSlotItem[]
}

/**
 * One item in a `CompositionSlotValue.items` array. BYTE-IDENTICAL to v2. `itemId` is the same
 * kind of opaque, editor-generated, persisted string as `CompositionInstance.instanceId`/
 * `CompositionArrayItem.itemId` — stable per array-item identity, unique within its enclosing
 * `items` array.
 *
 * `"void"` is kept as an explicit, addressable "empty slot item" distinct from omitting an item
 * from `items` entirely — it still counts toward `items.length` for `maxItems` purposes but never
 * toward a `minItems`/required check.
 */
export type CompositionSlotItem =
    | { itemId: string, kind: "instance", instance: CompositionInstance }
    | { itemId: string, kind: "text", value: string }
    | { itemId: string, kind: "void" }

/**
 * v3 composition document. `schemaVersion: 3` only — a `2` or `1` document is a different type
 * (`CompositionDocumentV2`/`CompositionDocumentV1`, below) and must go through
 * `migrateCompositionDocumentV2ToV3`/`migrateCompositionDocumentV1ToV2` (validate.ts) before it is a
 * `CompositionDocument`. `validateComposition`/`renderComposition`/`exportToTsx` accept
 * `CompositionDocument | CompositionDocumentV2 | CompositionDocumentV1` at the type level
 * specifically so they can inspect `schemaVersion` at runtime and produce the
 * `"unsupported-schema-version"` diagnostic (never silently reinterpreting v1/v2 structure) rather
 * than refusing to compile against a real on-disk v1/v2 document.
 *
 * Root identity: `root` is a `CompositionInstance` like any other, with its own `instanceId` - no
 * special-cased "root has no id" exception, unchanged from v2.
 */
/** Explicit public API of a composed component. Runtime values never enter this declaration. */
export interface CompositionPropDeclaration {
    schema: SchemaJson
    required: boolean
    defaultValue?: ValueJson
    description?: string
    /** Explicit source for exact TypeScript types, including native React callback signatures. */
    typeSource?: {componentId: string, propName: string}
}

export type CompositionDocument =
    | {schemaVersion: 3 | 4, root: CompositionInstance, props?: never}
    | {schemaVersion: 5, root: CompositionInstance, props: Record<string, CompositionPropDeclaration>}
    | {schemaVersion: 6, root: CompositionInstance, props: Record<string, CompositionPropDeclaration>, locals?: Record<string, CompositionLocal>}

/** Whether a document declares public props: schemaVersion 5 and later. */
export function declaresProps(doc: {schemaVersion: number}): doc is Extract<CompositionDocument, {schemaVersion: 5 | 6}> {
    return doc.schemaVersion === 5 || doc.schemaVersion === 6
}


// ---------------------------------------------------------------------------------------------
// v2 shapes (unchanged from the phase-2/phase-3 implementation), kept only as
// `migrateCompositionDocumentV2ToV3`'s documented input type. Nothing else in this package
// constructs or consumes these.
// ---------------------------------------------------------------------------------------------

export type CompositionPropValueV2 =
    | { kind: "value", value: ValueJson }
    | { kind: "callback", name: string }
    | { kind: "componentRef", value: ComponentIdentity }
    | { kind: "richText", value: RichTextValueJson }
    | { kind: "nodes", value: CompositionSlotValueV2 }

export interface CompositionInstanceV2 {
    kind: "instance"
    instanceId: string
    componentId: string
    props: Record<string, CompositionPropValueV2>
}

// V2-specific slot value/item types, parametrized over CompositionInstanceV2 - kept distinct from
// the unsuffixed (v3) CompositionSlotValue/CompositionSlotItem above, which are now parametrized
// over the repurposed (v3) CompositionInstance. Structurally identical to the v3 shape field-by-
// field (same "itemId"/"kind"/"instance"/"value" fields) - only the recursive "instance" field's
// own prop-value shape differs, exactly mirroring why CompositionInstanceV1's old CompositionNodeV1
// needed its own distinct recursive type too.
export interface CompositionSlotValueV2 {
    items: CompositionSlotItemV2[]
}

export type CompositionSlotItemV2 =
    | { itemId: string, kind: "instance", instance: CompositionInstanceV2 }
    | { itemId: string, kind: "text", value: string }
    | { itemId: string, kind: "void" }

export interface CompositionDocumentV2 {
    schemaVersion: 2
    root: CompositionInstanceV2
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
