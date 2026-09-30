import {ComponentMetadata, Diagnostic, MetadataDocument} from "@/schema/metadata";
import {EffectiveSlotRule, SlotPolicy} from "@/schema/SlotPolicy";
import {isPathResolutionDiagnostic, pathEquals, resolvePath, SlotPath, stripNullish} from "@/schema/SlotPath";
import {ReactNodeSchema} from "@/schema/ReactNode";
import {ComponentTypeSchema} from "@/schema/ComponentType";
import {ComponentIdentity, componentIdentityEquals} from "@/schema/ComponentIdentity";
import {ComponentGroup, isComponentGroup, SlotAcceptance} from "@/schema/ComponentGroup";
import {ComponentLibraryData, findComponentEntry} from "@/component";

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

export type SlotItemCandidate =
    | { itemId: string, kind: "instance", instance: { componentId: string } }
    | { itemId: string, kind: "text", value: string }
    | { itemId: string, kind: "void" }

export interface SlotCheckContext {
    library: ComponentLibraryData
    currentItemCount: number
    currentNonVoidCount: number
    metadata?: MetadataDocument
}

export type SlotCheckResult =
    | { ok: true }
    | { ok: false, diagnostics: Diagnostic[] }

const OK: SlotCheckResult = {ok: true}

function fail(code: string, message: string): SlotCheckResult {
    return {ok: false, diagnostics: [{severity: "error", code, message}]}
}

function isComponentIdentity(candidate: SlotItemCandidate | ComponentIdentity): candidate is ComponentIdentity {
    return "source" in candidate
}

function isValidCandidate(value: unknown): value is SlotItemCandidate | ComponentIdentity {
    if (typeof value !== "object" || value === null) return false
    const candidate = value as Record<string, unknown>
    if (candidate["source"] === "project") return typeof candidate["id"] === "string"
    if (candidate["source"] === "external") return typeof candidate["package"] === "string"
        && typeof candidate["exportName"] === "string" && typeof candidate["isDefault"] === "boolean"
        && (candidate["subpath"] === undefined || typeof candidate["subpath"] === "string")
    if (typeof candidate["itemId"] !== "string") return false
    if (candidate["kind"] === "void") return true
    if (candidate["kind"] === "text") return typeof candidate["value"] === "string"
    if (candidate["kind"] !== "instance" || typeof candidate["instance"] !== "object" || candidate["instance"] === null) return false
    return typeof (candidate["instance"] as Record<string, unknown>)["componentId"] === "string"
}

function resolveCardinality(policy: SlotPolicy): { minItems: number, maxItems?: number } {
    if (policy.kind === "any") return {minItems: policy.minItems ?? 0, maxItems: policy.maxItems}
    if (policy.kind === "components") {
        const multiple = policy.multiple ?? false
        return {minItems: policy.minItems ?? 0, maxItems: policy.maxItems ?? (multiple ? undefined : 1)}
    }
    return {minItems: 0, maxItems: undefined}
}
export function resolveComponentIdentityEntry(identity: ComponentIdentity, context: Pick<SlotCheckContext, "library" | "metadata">) {
    if (identity.source === "project") return findComponentEntry(context.library, identity.id)
    const id = context.metadata?.components.find(component => component.external && componentIdentityEquals(component.external, identity))?.id
    return id === undefined ? undefined : findComponentEntry(context.library, id)
}

export function isComponentGroupRegistered(library: ComponentLibraryData, group: ComponentGroup): boolean {
    return library.componentGroups?.some(candidate => candidate.id === group.id) === true
        || library.files.some(file => Object.values(file.components).some(entry => entry.groups?.some(candidate => candidate.id === group.id)))
}

export function acceptsComponent(accepts: SlotAcceptance[], identity: ComponentIdentity, context: Pick<SlotCheckContext, "library" | "metadata">): SlotCheckResult {
    const unknown = accepts.filter(isComponentGroup).filter(group => !isComponentGroupRegistered(context.library, group))
    if (unknown.length) return {ok: false, diagnostics: unknown.map(group => ({severity: "error", code: "group-not-registered", message: `Component group "${group.id}" is not registered in the component library`}))}
    const entry = resolveComponentIdentityEntry(identity, context)
    if (!entry) return fail("component-not-in-library", "Component identity is not registered in the component library")
    return accepts.some(accepted => isComponentGroup(accepted)
        ? entry.groups?.some(group => group.id === accepted.id) === true
        : componentIdentityEquals(accepted, identity))
        ? OK : fail("component-not-accepted", "Component is not accepted by this slot's groups or component identities")
}
function resolveInstanceIdentity(componentId: string, metadata: MetadataDocument | undefined): ComponentIdentity {
    const external = metadata?.components.find(c => c.id === componentId)?.external
    return external ?? {source: "project", id: componentId}
}

function checkComponentRef(policy: SlotPolicy, candidate: ComponentIdentity, context: SlotCheckContext): SlotCheckResult {
    if (policy.kind !== "componentRef")
        return fail("policy-type-mismatch", `A component reference is not accepted by a "${policy.kind}" policy`)
    return acceptsComponent(policy.accepts, candidate, context)
}

function checkSlotItem(policy: SlotPolicy, candidate: SlotItemCandidate, context: SlotCheckContext): SlotCheckResult {
    if (policy.kind === "componentRef")
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
    if (policy.kind === "any") {
        if (!findComponentEntry(context.library, candidate.instance.componentId))
            return fail("component-not-in-library", `Component "${candidate.instance.componentId}" is not registered in the component library`)
        return OK
    }
    const identity = resolveInstanceIdentity(candidate.instance.componentId, context.metadata)
    return acceptsComponent(policy.accepts, identity, context)
}

export function checkSlotValue(
    rule: EffectiveSlotRule | undefined,
    candidate: SlotItemCandidate | ComponentIdentity,
    context: SlotCheckContext
): SlotCheckResult {
    if (!rule?.slot) return fail("not-a-slot", "No slot policy applies at this path")
    if (!isValidCandidate(candidate)) return fail("invalid-slot-value", "Slot value must be a component identity or a supported node item")

    const policy = rule.slot

    if (isComponentIdentity(candidate)) return checkComponentRef(policy, candidate, context)
    return checkSlotItem(policy, candidate, context)
}
