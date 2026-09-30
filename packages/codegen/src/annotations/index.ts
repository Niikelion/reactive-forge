// Orchestrator: wires colocated discovery, external identity resolution, project override
// sources, and precedence merging (docs/slot-contract.md sections 4-5) into the
// `ComponentMetadata.slots`/`external`/`MetadataDocument.externalLibraries` fields
// `generate.ts`'s `buildMetadataDocument` writes.

import { Project } from "ts-morph"
import { registerCommonSchemas } from "@reactive-forge/schema"
import type { PropMetadata } from "@reactive-forge/schema"
import type { AnnotationSourcesConfig } from "../index.js"
import { ComponentData } from "../types.js"
import { Diagnostic } from "../metadataTypes.js"
import { componentId } from "../hash.js"
import { buildProps } from "../metadataProps.js"
import { ExternalComponentIdentity, ExternalLibraryRef, EffectiveSlotRule } from "../slotTypes.js"
import { discoverColocatedAnnotations, discoverOverrideAnnotations } from "./colocated.js"
import { resolveLibraryAnnotationSources } from "./external.js"
import { AuthoredRule, mergeAuthoredRules } from "./merge.js"
import { checkPolicyCompatibility, isPathResolutionDiagnostic, resolvePath } from "./pathResolve.js"

export interface ExternalComponentResult {
    id: string
    data: ComponentData
    external: ExternalComponentIdentity
}

export interface SlotAnnotationResult {
    used: boolean
    slotsByComponentId: Map<string, EffectiveSlotRule[]>
    extraDiagnosticsByComponentId: Map<string, Diagnostic[]>
    externalComponents: ExternalComponentResult[]
    externalLibraries: ExternalLibraryRef[]
}

function addDiagnostics(map: Map<string, Diagnostic[]>, id: string, diagnostics: Diagnostic[]) {
    if (diagnostics.length === 0) return
    map.set(id, [...(map.get(id) ?? []), ...diagnostics])
}

function resolveMergedRules(
    componentId: string,
    props: Record<string, PropMetadata>,
    grouped: AuthoredRule[],
    diagnosticsMap: Map<string, Diagnostic[]>
): EffectiveSlotRule[] {
    const merged = mergeAuthoredRules(grouped)
    const effective: EffectiveSlotRule[] = []

    for (const { rule, diagnostics } of merged.values()) {
        addDiagnostics(diagnosticsMap, componentId, diagnostics)

        const target = resolvePath(props, rule.path)
        if (isPathResolutionDiagnostic(target)) {
            addDiagnostics(diagnosticsMap, componentId, [{
                ...target,
                message: `Slot rule path [${rule.path.map(s => typeof s === "string" ? `"${s}"` : s.kind).join(", ")}] could not be resolved against the component's props: ${target.message}`
            }])
            continue
        }

        if (rule.slot !== undefined) {
            const compatibility = checkPolicyCompatibility(rule.slot, target)
            if (!compatibility.ok) {
                addDiagnostics(diagnosticsMap, componentId, [{
                    severity: "error",
                    code: "policy-type-mismatch",
                    message: `Slot policy "${rule.slot.kind}" is incompatible with its target path: ${compatibility.reason}`
                }])
                continue
            }
        }

        effective.push(rule)
    }

    return effective
}

export function buildSlotAnnotations(
    project: Project,
    components: ComponentData[],
    annotationSources: AnnotationSourcesConfig | undefined,
    rootDir: string,
    classOptions: ClassExtractionOptions = {}
): SlotAnnotationResult {
    const result: SlotAnnotationResult = {
        used: false,
        slotsByComponentId: new Map(),
        extraDiagnosticsByComponentId: new Map(),
        externalComponents: [],
        externalLibraries: []
    }

    if (!annotationSources) return result

    // schema's resolvePath (pathResolve.ts) round-trips PropMetadata.schema through
    // schemaFromJson, which needs the common schema factories registered. createCodegen already
    // does this once at startup; registerCommonSchemas() is idempotent (guarded internally), so
    // calling it here too makes buildSlotAnnotations safe for any direct API caller (tests
    // included) regardless of whether createCodegen ran first.
    registerCommonSchemas()

    const colocatedEnabled = annotationSources.colocated ?? true
    const allRules: AuthoredRule[] = []

    if (colocatedEnabled) {
        const colocated = discoverColocatedAnnotations(project, components, rootDir)
        allRules.push(...colocated.rules)
        for (const [id, diagnostics] of colocated.diagnosticsByComponentId) addDiagnostics(result.extraDiagnosticsByComponentId, id, diagnostics)
        if (colocated.rules.length > 0 || colocated.unmatchedDiagnostics.length > 0) result.used = true
    }

    if (annotationSources.overrideSources && annotationSources.overrideSources.length > 0) {
        const overrides = discoverOverrideAnnotations(project, annotationSources.overrideSources, rootDir, rootDir)
        allRules.push(...overrides.rules)
        for (const [id, diagnostics] of overrides.diagnosticsByComponentId) addDiagnostics(result.extraDiagnosticsByComponentId, id, diagnostics)
        result.used = true
    }

    if (annotationSources.libraries && annotationSources.libraries.length > 0) {
        const external = resolveLibraryAnnotationSources(project, annotationSources.libraries, rootDir, rootDir, classOptions)
        allRules.push(...external.rules)
        result.externalLibraries = external.libraryRefs
        for (const [id, componentData] of external.externalComponents)
            result.externalComponents.push({ id, data: componentData, external: componentData.external })
        result.used = true
    }

    const rulesByComponent = new Map<string, AuthoredRule[]>()
    for (const authored of allRules) {
        const list = rulesByComponent.get(authored.componentId) ?? []
        list.push(authored)
        rulesByComponent.set(authored.componentId, list)
    }

    for (const component of components) {
        const id = idOfProjectComponent(component, rootDir)
        const grouped = rulesByComponent.get(id)
        if (!grouped || grouped.length === 0) continue
        const slots = resolveMergedRules(id, buildProps(component), grouped, result.extraDiagnosticsByComponentId)
        result.slotsByComponentId.set(id, slots)
    }

    for (const external of result.externalComponents) {
        const grouped = rulesByComponent.get(external.id)
        if (!grouped || grouped.length === 0) continue
        const slots = resolveMergedRules(external.id, buildProps(external.data), grouped, result.extraDiagnosticsByComponentId)
        result.slotsByComponentId.set(external.id, slots)
    }

    return result
}

function idOfProjectComponent(component: ComponentData, rootDir: string): string {
    return componentId(rootDir, component.sourcePath, component.name)
}
import type {ClassExtractionOptions} from "../classBindings.js"
