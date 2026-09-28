import {ComponentMetadata, Diagnostic} from "@/schema/metadata";
import {EffectiveSlotRule, SlotPolicy} from "@/schema/SlotPolicy";
import {isPathResolutionDiagnostic, pathEquals, resolvePath, SlotPath, stripNullish} from "@/schema/SlotPath";
import {ReactNodeSchema} from "@/schema/ReactNode";
import {ComponentTypeSchema} from "@/schema/ComponentType";
import {ComponentIdentity, componentIdentityEquals} from "@/schema/ComponentIdentity";
import {RichTextBlockNode, RichTextTextNode, RichTextValueJson} from "@/schema/RichText";
import {ComponentLibraryData, findComponentEntry} from "@/component";

// Shared policy resolver/validator, docs/slot-contract.md section 8. Pure functions — no React, no
// ts-morph, no I/O — so codegen, runtime, and editor can all depend on them with no layering
// violation.

/**
 * Looks up `metadata.slots` for an exact canonical-path match (structural equality of resolved
 * segments, via `pathEquals`). When no explicit rule exists, resolves `path` against
 * `metadata.props` (via `resolvePath`, section 2) to decide whether the path is genuinely
 * slot-domain at all:
 *
 * - A `ReactNodeSchema` target with no explicit rule gets the synthesized `AnyNodePolicy` default
 *   (section 3, "Unannotated ReactNode default").
 * - A `ComponentTypeSchema` target with no explicit rule gets a rule shell with `slot` left
 *   `undefined`. Section 3 does not actually define what an "any" default would even mean for a
 *   constructor-reference path (only `componentRef` is a compatible policy kind for
 *   `ComponentTypeSchema` per section 3's compatibility table, and `AnyNodePolicy` is explicitly
 *   incompatible with it) — section 4's "inferred layer applies to every ReactNode/ComponentType
 *   domain path" is read here as "an inferred layer entry exists for bookkeeping," not as "the
 *   same AnyNodePolicy shape applies," since that shape would immediately fail the section 3
 *   compatibility check it is itself subject to. Treating "no rule" as "accepts nothing" is the
 *   conservative reading for arbitrary constructor substitution, which has no stated default
 *   acceptance the way plain ReactNode content does.
 * - Any other target schema (or a path that fails to resolve at all) is not slot-domain: `undefined`.
 */
export function resolveSlotPolicy(metadata: ComponentMetadata, path: SlotPath): EffectiveSlotRule | undefined {
    const explicit = metadata.slots?.find(rule => pathEquals(rule.path, path))
    if (explicit) return explicit

    const resolved = resolvePath(metadata.props, path)
    if (isPathResolutionDiagnostic(resolved)) return undefined

    const target = stripNullish(resolved)

    if (target instanceof ReactNodeSchema) {
        return {
            path,
            slot: {kind: "any", multiple: true, minItems: 0},
            appliedFrom: {slot: "inferred"},
        }
    }

    if (target instanceof ComponentTypeSchema) {
        return {path, appliedFrom: {}}
    }

    return undefined
}

/**
 * Minimal, structurally-duck-typed subset of the runtime package's `CompositionSlotItem`
 * (docs/slot-contract.md section 7 — owned by `packages/runtime`, which `packages/schema` must
 * never depend on to avoid a layering cycle). Only the fields `checkSlotValue` actually needs are
 * declared here; a real `CompositionSlotItem` from `packages/runtime` satisfies this structurally
 * (TypeScript structural typing accepts a richer object wherever this narrower shape is expected).
 */
export type SlotItemCandidate =
    | { itemId: string, kind: "instance", instance: { componentId: string } }
    | { itemId: string, kind: "text", value: string }
    | { itemId: string, kind: "void" }

export interface SlotCheckContext {
    library: ComponentLibraryData
    currentItemCount: number
    currentNonVoidCount: number
}

export type SlotCheckResult =
    | { ok: true }
    | { ok: false, diagnostics: Diagnostic[] }

const OK: SlotCheckResult = {ok: true}

function fail(code: string, message: string): SlotCheckResult {
    return {ok: false, diagnostics: [{severity: "error", code, message}]}
}

function isRichTextValue(candidate: SlotItemCandidate | RichTextValueJson | ComponentIdentity): candidate is RichTextValueJson {
    return "kind" in candidate && candidate.kind === "richText"
}

function isComponentIdentity(candidate: SlotItemCandidate | RichTextValueJson | ComponentIdentity): candidate is ComponentIdentity {
    return "source" in candidate
}

function acceptsIdentity(accepts: ComponentIdentity[], candidate: ComponentIdentity): boolean {
    return accepts.some(a => componentIdentityEquals(a, candidate))
}

function resolveCardinality(policy: SlotPolicy): { minItems: number, maxItems?: number } {
    if (policy.kind === "any") return {minItems: policy.minItems ?? 0, maxItems: policy.maxItems}
    if (policy.kind === "components") {
        const multiple = policy.multiple ?? false
        return {minItems: policy.minItems ?? 0, maxItems: policy.maxItems ?? (multiple ? undefined : 1)}
    }
    return {minItems: 0, maxItems: undefined}
}

function collectRichTextNodes(value: RichTextValueJson): RichTextTextNode[] {
    if (value.inline) return value.nodes
    return value.nodes.flatMap((node: RichTextBlockNode) =>
        node.type === "paragraph" ? node.children : node.items.flatMap(item => item.children))
}

function checkRichText(policy: SlotPolicy, candidate: RichTextValueJson): SlotCheckResult {
    if (policy.kind !== "richText")
        return fail("policy-type-mismatch", `A rich text value is not accepted by a "${policy.kind}" policy`)

    if (candidate.inline !== policy.inline)
        return fail("richtext-inline-mismatch", `Rich text value inline=${String(candidate.inline)} does not match policy inline=${String(policy.inline)}`)

    const diagnostics: Diagnostic[] = []

    for (const node of collectRichTextNodes(candidate)) {
        for (const mark of node.marks) {
            if (!policy.marks.includes(mark))
                diagnostics.push({severity: "error", code: "richtext-mark-not-accepted", message: `Mark "${mark}" is not accepted by this slot's policy`})
        }
    }

    if (!candidate.inline) {
        for (const node of candidate.nodes) {
            if (node.type === "paragraph" && policy.blocks?.paragraphs === false)
                diagnostics.push({severity: "error", code: "richtext-block-not-accepted", message: "Paragraph nodes are not accepted by this slot's policy"})
            if ((node.type === "bulletList" || node.type === "orderedList") && policy.blocks?.lists === false)
                diagnostics.push({severity: "error", code: "richtext-block-not-accepted", message: "List nodes are not accepted by this slot's policy"})
        }
    }

    return diagnostics.length > 0 ? {ok: false, diagnostics} : OK
}

function checkComponentRef(policy: SlotPolicy, candidate: ComponentIdentity): SlotCheckResult {
    if (policy.kind !== "componentRef")
        return fail("policy-type-mismatch", `A component reference is not accepted by a "${policy.kind}" policy`)
    if (!acceptsIdentity(policy.accepts, candidate))
        return fail("component-not-accepted", "Component identity is not in this slot's accepted list")
    return OK
}

function checkSlotItem(policy: SlotPolicy, candidate: SlotItemCandidate, context: SlotCheckContext): SlotCheckResult {
    if (policy.kind === "richText" || policy.kind === "componentRef")
        return fail("policy-type-mismatch", `A node item is not accepted by a "${policy.kind}" policy`)

    const cardinality = resolveCardinality(policy)
    if (cardinality.maxItems !== undefined && context.currentItemCount + 1 > cardinality.maxItems)
        return fail("slot-max-items-exceeded", `Slot already holds ${String(context.currentItemCount)} item(s); maxItems is ${String(cardinality.maxItems)}`)

    if (candidate.kind === "void") return OK

    if (candidate.kind === "text") {
        if (policy.kind !== "any")
            return fail("text-not-accepted", `Plain text is not accepted by a "${policy.kind}" policy`)
        return OK
    }

    // candidate.kind === "instance"
    if (policy.kind === "any") {
        if (!findComponentEntry(context.library, candidate.instance.componentId))
            return fail("component-not-in-library", `Component "${candidate.instance.componentId}" is not registered in the component library`)
        return OK
    }

    // policy.kind === "components"
    if (!acceptsIdentity(policy.accepts, {source: "project", id: candidate.instance.componentId}))
        return fail("component-not-accepted", `Component "${candidate.instance.componentId}" is not in this slot's accepted list`)
    return OK
}

/**
 * Validates `candidate` (a node item, a rich text value, or a component identity — see
 * `SlotItemCandidate`) against `rule`'s resolved policy. `rule` is normally the result of
 * `resolveSlotPolicy`; a `rule` with no `slot` populated (either because it's `undefined`, or
 * because `resolveSlotPolicy` returned a bare rule shell for an unruled `ComponentType` path)
 * always rejects with `"not-a-slot"`.
 */
export function checkSlotValue(
    rule: EffectiveSlotRule | undefined,
    candidate: SlotItemCandidate | RichTextValueJson | ComponentIdentity,
    context: SlotCheckContext
): SlotCheckResult {
    if (!rule?.slot) return fail("not-a-slot", "No slot policy applies at this path")

    const policy = rule.slot

    if (isRichTextValue(candidate)) return checkRichText(policy, candidate)
    if (isComponentIdentity(candidate)) return checkComponentRef(policy, candidate)
    return checkSlotItem(policy, candidate, context)
}
