// Path resolution (docs/slot-contract.md section 2) delegates to `@reactive-forge/schema`'s
// canonical `resolvePath`/`resolveSegment`/`stripNullish` (`packages/schema/src/schema/
// SlotPath.ts`) - not a local copy. This module previously carried its own duplicate
// implementation (a documented judgment call made before the schema/path-helpers worker's
// equivalent was confirmed to exist); once it was, this file was reduced to a thin adapter plus
// the one piece the contract's section 3 needs that `packages/schema` does not itself provide:
// the build-time "policy/prop-type compatibility" gate.
//
// `resolveSlotPolicy`/`checkSlotValue` (schema's `SlotCheck.ts`, section 8) are the *runtime*
// value-checking functions - they validate a composition-document value against an already-merged
// policy. They are not the same thing as this module's `checkPolicyCompatibility`, which is a
// one-shot, build-time gate run once per merged rule ("checked once, after merging ... before a
// rule is written into ComponentMetadata.slots", section 3) comparing a policy's `kind` against
// the resolved target schema's *kind* (ReactNode vs ComponentType domain) - ComponentMetadata
// author-time typechecking, not composition-document value validation. Kept local to codegen
// since nothing else in the system needs to re-run it.

import { PropMetadata, ReactNodeSchema, ComponentTypeSchema, Schema, resolvePath as schemaResolvePath, isPathResolutionDiagnostic } from "@reactive-forge/schema"
import { Diagnostic } from "../metadataTypes.js"
import { SlotPath, SlotPolicy } from "../slotTypes.js"

export type ResolutionResult = Schema | Diagnostic

export function resolvePath(props: Record<string, PropMetadata>, path: SlotPath): ResolutionResult {
    return schemaResolvePath(props, path)
}

export { isPathResolutionDiagnostic }

function isReactNodeDomain(schema: Schema): boolean {
    return schema instanceof ReactNodeSchema
}

function isComponentTypeDomain(schema: Schema): boolean {
    return schema instanceof ComponentTypeSchema
}

export type PolicyCompatibility = { ok: true } | { ok: false, reason: string }

// Section 3's compatibility table, checked once after merging.
export function checkPolicyCompatibility(policy: SlotPolicy, target: Schema): PolicyCompatibility {
    if (policy.kind === "componentRef") {
        if (isComponentTypeDomain(target)) return { ok: true }
        return { ok: false, reason: "componentRef policy targets a non-ComponentType path" }
    }
    if (isReactNodeDomain(target)) return { ok: true }
    return { ok: false, reason: `${policy.kind} policy targets a non-ReactNode path` }
}
