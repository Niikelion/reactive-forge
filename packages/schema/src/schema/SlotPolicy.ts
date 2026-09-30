import {ComponentIdentity} from "@/schema/ComponentIdentity";
import {RichTextMark} from "@/schema/RichText";
import {SlotPath} from "@/schema/SlotPath";
import type {EditorPresentation} from "@/schema/EditorPresentation";

// Slot policy types, docs/slot-contract.md sections 3-4. Plain, JSON-safe data — no React,
// no ts-morph.

export interface AnyNodePolicy {
    kind: "any"
    multiple?: boolean
    minItems?: number
    maxItems?: number
}

export interface ComponentsPolicy {
    kind: "components"
    accepts: ComponentIdentity[]
    multiple?: boolean
    minItems?: number
    maxItems?: number
}

export interface RichTextPolicy {
    kind: "richText"
    inline: boolean
    marks: RichTextMark[]
    blocks?: { paragraphs?: boolean, lists?: boolean }
}

export interface ComponentRefPolicy {
    kind: "componentRef"
    accepts: ComponentIdentity[]
}

export type SlotPolicy =
    | AnyNodePolicy
    | ComponentsPolicy
    | RichTextPolicy
    | ComponentRefPolicy

// Authoring API, section 4. `SlotRule` is what `defineComponentMetadata`/`defineLibraryMetadata`
// calls compile down to; codegen statically ingests these (this package never parses source).
export interface SlotRule {
    editor?: EditorPresentation
    path: SlotPath
    collection?: { minItems?: number, maxItems?: number }
    slot?: SlotPolicy
}

export type SlotLayer = "inferred" | "library" | "project"

export interface EffectiveSlotRule {
    editor?: EditorPresentation
    editorAppliedFrom?: Partial<Record<keyof EditorPresentation, SlotLayer>>
    path: SlotPath
    collection?: { minItems?: number, maxItems?: number }
    slot?: SlotPolicy
    appliedFrom: { collection?: SlotLayer, slot?: SlotLayer }
}

/** `docs/slot-contract.md` section 4's `mergeField` — incoming wins when defined, else base survives. */
export function mergeField<T>(base: T | undefined, incoming: T | undefined): T | undefined {
    return incoming ?? base
}

export function mergeCollection(
    base: { minItems?: number, maxItems?: number } | undefined,
    incoming: { minItems?: number, maxItems?: number } | undefined
): { minItems?: number, maxItems?: number } | undefined {
    if (incoming === undefined) return base
    return {
        minItems: mergeField(base?.minItems, incoming.minItems),
        maxItems: mergeField(base?.maxItems, incoming.maxItems),
    }
}

/**
 * Field-by-field replace, per section 4: a `kind` switch is a full replace; within the same
 * `kind`, incoming's own keys win and base's keys not restated by incoming survive
 * ({...base, ...incoming}) — array-valued fields (`accepts`, `marks`) and `blocks` therefore
 * replace wholesale whenever incoming specifies them at all (even `[]`/`{}`), never concatenate,
 * because they are simply one of incoming's own keys.
 */
export function mergeSlotPolicy(base: SlotPolicy | undefined, incoming: SlotPolicy | undefined): SlotPolicy | undefined {
    if (incoming === undefined) return base
    if (base === undefined || base.kind !== incoming.kind) return incoming
    return {...base, ...incoming} as SlotPolicy
}

export function mergeRule(base: EffectiveSlotRule | undefined, incoming: SlotRule, layer: SlotLayer): EffectiveSlotRule {
    return {
        ...(incoming.editor !== undefined || base?.editor !== undefined ? {
            editor: {...base?.editor, ...incoming.editor},
            editorAppliedFrom: {...base?.editorAppliedFrom, ...Object.fromEntries(Object.keys(incoming.editor ?? {}).map(key => [key, layer]))}
        } : {}),
        path: incoming.path,
        collection: mergeCollection(base?.collection, incoming.collection),
        slot: mergeSlotPolicy(base?.slot, incoming.slot),
        appliedFrom: {
            collection: incoming.collection !== undefined ? layer : base?.appliedFrom.collection,
            slot: incoming.slot !== undefined ? layer : base?.appliedFrom.slot,
        },
    }
}
