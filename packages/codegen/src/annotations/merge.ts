// Precedence and merging - docs/slot-contract.md section 4. `mergeCollection`/`mergeSlotPolicy`/
// `mergeRule` are the canonical implementations from `@reactive-forge/schema`
// (`packages/schema/src/schema/SlotPolicy.ts`), not a local copy - this module previously carried
// its own duplicate (a deliberate, documented judgment call made before the schema/path-helpers
// worker's equivalent was confirmed to exist; see this worker's final report for the direct
// field-for-field comparison that justified switching). What stays local here is same-layer
// conflict detection ("Same-layer conflicts") and cross-layer orchestration
// (`mergeAuthoredRules`), neither of which the schema package's single-rule `mergeRule` performs -
// it folds one `SlotRule` into a base at a time and has no notion of "two rules in the same layer."

import { mergeRule } from "@reactive-forge/schema"
import { Diagnostic } from "../metadataTypes.js"
import { EffectiveSlotRule, SlotLayer, SlotPath, SlotPolicy, SlotRule } from "../slotTypes.js"

export interface AuthoredRule {
    rule: SlotRule
    layer: SlotLayer
    location?: Diagnostic["location"]
    // Which component's ComponentMetadata.slots this rule contributes to - a project id (section
    // 5's `{source: "project", id}`) or an external id (`shortHash("external\0...")`). Grouping by
    // this field (not just by path) is the caller's job; mergeAuthoredRules only ever receives the
    // rules for one component at a time.
    componentId: string
}

export function canonicalPathKey(path: SlotPath): string {
    return JSON.stringify(path.map(segment =>
        typeof segment === "string" ? { t: "lit", v: segment } :
        segment.kind === "each" ? { t: "each" } :
        { t: "variant", prop: segment.prop, equals: segment.equals }))
}

function conflictDiagnostic(field: string, first: AuthoredRule, second: AuthoredRule): Diagnostic {
    const firstLoc = first.location ? `${first.location.sourcePath}:${String(first.location.line)}:${String(first.location.column)}` : "<unknown>"
    const secondLoc = second.location ? `${second.location.sourcePath}:${String(second.location.line)}:${String(second.location.column)}` : "<unknown>"
    return {
        severity: "error",
        code: "slot-rule-conflict",
        message: `Conflicting "${field}" set by two ${first.layer}-layer rules for the same path: ${firstLoc} and ${secondLoc}. The first rule wins for this field.`,
        location: second.location
    }
}

// Folds every same-layer rule targeting one canonical path, in source-scan order, applying
// "first rule to set a field wins" (section 4, "Same-layer conflicts").
function foldLayer(rules: AuthoredRule[]): { collection?: SlotRule["collection"], slot?: SlotPolicy, diagnostics: Diagnostic[] } {
    let collection: SlotRule["collection"]
    let collectionSetBy: AuthoredRule | undefined
    let slot: SlotPolicy | undefined
    let slotSetBy: AuthoredRule | undefined
    const diagnostics: Diagnostic[] = []

    for (const authored of rules) {
        const incomingCollection = authored.rule.collection
        if (incomingCollection !== undefined) {
            if (collection === undefined) {
                collection = incomingCollection
                collectionSetBy = authored
            } else {
                let merged = collection
                for (const field of ["minItems", "maxItems"] as const) {
                    const value = incomingCollection[field]
                    if (value === undefined) continue
                    if (merged[field] === undefined) merged = { ...merged, [field]: value }
                    else if (merged[field] !== value && collectionSetBy)
                        diagnostics.push(conflictDiagnostic(`collection.${field}`, collectionSetBy, authored))
                }
                collection = merged
            }
        }

        const incomingSlot = authored.rule.slot
        if (incomingSlot !== undefined) {
            if (slot === undefined) {
                slot = incomingSlot
                slotSetBy = authored
            } else if (slot.kind !== incomingSlot.kind) {
                if (slotSetBy) diagnostics.push(conflictDiagnostic("slot.kind", slotSetBy, authored))
                // first rule wins: `slot` is left unchanged.
            } else {
                let merged: SlotPolicy = slot
                for (const [key, value] of Object.entries(incomingSlot) as [string, unknown][]) {
                    if (key === "kind" || value === undefined) continue
                    const currentValue = (slot as unknown as Record<string, unknown>)[key]
                    if (currentValue === undefined) {
                        merged = { ...merged, [key]: value } as SlotPolicy
                    } else if (JSON.stringify(currentValue) !== JSON.stringify(value) && slotSetBy) {
                        diagnostics.push(conflictDiagnostic(`slot.${key}`, slotSetBy, authored))
                    }
                }
                slot = merged
            }
        }
    }

    return { collection, slot, diagnostics }
}

export interface MergeResult {
    rule: EffectiveSlotRule
    diagnostics: Diagnostic[]
}

// Groups `rules` (already tagged with their layer) by canonical path and folds them in layer
// order `inferred -> library -> project` (section 4's merge algorithm). `rules` never contains an
// explicit "inferred" entry - the inferred `AnyNodePolicy` seed (section 3's default) is the
// caller's job (it depends on the target schema being ReactNode-domain, which this module doesn't
// resolve - see pathResolve.ts / annotations/index.ts).
export function mergeAuthoredRules(rules: AuthoredRule[]): Map<string, MergeResult> {
    const byPath = new Map<string, AuthoredRule[]>()
    for (const authored of rules) {
        const key = canonicalPathKey(authored.rule.path)
        const list = byPath.get(key) ?? []
        list.push(authored)
        byPath.set(key, list)
    }

    const layerOrder: SlotLayer[] = ["library", "project"]
    const result = new Map<string, MergeResult>()

    for (const [key, groupRules] of byPath) {
        let effective: EffectiveSlotRule | undefined
        const diagnostics: Diagnostic[] = []
        const path = groupRules[0]?.rule.path ?? []

        for (const layer of layerOrder) {
            const layerRules = groupRules.filter(r => r.layer === layer)
            if (layerRules.length === 0) continue
            const folded = foldLayer(layerRules)
            diagnostics.push(...folded.diagnostics)
            effective = mergeRule(effective, { path, collection: folded.collection, slot: folded.slot }, layer)
        }

        if (effective === undefined) continue
        result.set(key, { rule: effective, diagnostics })
    }

    return result
}
