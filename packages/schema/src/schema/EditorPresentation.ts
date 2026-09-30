import type {ComponentMetadata, Diagnostic} from "@/schema/metadata"
import {isPathResolutionDiagnostic, pathEquals, resolvePath, SlotPath, stripNullish} from "@/schema/SlotPath"
import {ObjectSchema} from "@/schema/Object"
import {ArraySchema} from "@/schema/Array"
import {UnionSchema} from "@/schema/Union"
import type {Schema} from "@/schema/Schema"
import type {SlotLayer} from "@/schema/SlotPolicy"

export interface PropProvenance {
    origin: "native" | "component" | "unknown"
    exposure: "broad" | "explicit" | "unknown"
    declarations?: {sourcePath: string, typeName?: string}[]
}

export interface EditorPresentation {
    visibility?: "primary" | "advanced" | "hidden" | "auto"
    group?: string
    label?: string
}

export interface EditorRule {
    path: SlotPath
    editor: EditorPresentation
    appliedFrom: Partial<Record<keyof EditorPresentation, SlotLayer>>
}

export interface ResolvedEditorPresentation {
    visibility: "primary" | "advanced" | "hidden"
    group?: string
    label?: string
    source: SlotLayer | "required" | "ancestor"
    reason: string
    diagnostics: Diagnostic[]
}

function hasRootDefault(component: ComponentMetadata, path: SlotPath): boolean {
    const root = path[0]
    return typeof root === "string" && component.props[root]?.defaultValue !== undefined
}

function requiredPath(component: ComponentMetadata, path: SlotPath): boolean {
    if (hasRootDefault(component, path)) return false
    const last = path[path.length - 1]
    if (typeof last !== "string") return false
    if (path.length === 1) {
        const prop = component.props[last]
        // Example values and current document values never count as source defaults.
        return prop?.required === true && prop.defaultValue === undefined
    }
    const parent = resolvePath(component.props, path.slice(0, -1))
    if (isPathResolutionDiagnostic(parent)) return false
    const requiredIn = (schema: Schema): boolean => schema instanceof ObjectSchema
        ? schema.properties[last]?.required === true
        : schema instanceof UnionSchema && schema.types.some(requiredIn)
    return requiredIn(stripNullish(parent))
}

function protectsRequiredFields(component: ComponentMetadata, path: SlotPath): boolean {
    if (hasRootDefault(component, path)) return false
    const resolved = resolvePath(component.props, path)
    if (isPathResolutionDiagnostic(resolved)) return false
    const containsRequired = (schema: Schema): boolean => {
        if (schema instanceof ObjectSchema) return Object.values(schema.properties).some(prop => prop.required || containsRequired(prop.schema))
        if (schema instanceof ArraySchema) return schema.tupleTypes.some(containsRequired) || (schema.indexType !== undefined && containsRequired(schema.indexType))
        if (schema instanceof UnionSchema) return schema.types.some(containsRequired)
        return false
    }
    // Keep ancestors accessible, including arrays and discriminated branches.
    return containsRequired(resolved)
}

/** Presentation is independent of runtime validation and of the document's current values. */
export function resolveEditorPresentation(component: ComponentMetadata, path: SlotPath): ResolvedEditorPresentation {
    if (path.length === 0) return {visibility: "primary", source: "inferred", reason: "A presentation path must target a prop", diagnostics: [{severity: "error", code: "invalid-editor-path", message: "Editor presentation paths must target a prop, not the component root"}]}
    const target = resolvePath(component.props, path)
    if (isPathResolutionDiagnostic(target)) return {visibility: "primary", source: "inferred", reason: "Invalid presentation path", diagnostics: [target]}
    const exact = component.editorRules?.find(rule => pathEquals(rule.path, path))
    const root = path[0]
    const provenance = typeof root === "string" ? component.props[root]?.provenance : undefined
    const inferred = provenance?.origin === "native" && provenance.exposure === "broad" ? "advanced" : "primary"
    const requested = exact?.editor.visibility
    const explicit = requested !== undefined && requested !== "auto"
    let visibility: ResolvedEditorPresentation["visibility"] = explicit ? requested : inferred
    let source: ResolvedEditorPresentation["source"] = explicit ? exact?.appliedFrom.visibility ?? "library" : "inferred"
    let reason = explicit ? `${source} annotation` : inferred === "advanced" ? "Broadly inherited native prop" : "Component API or unclassified prop"
    const diagnostics: Diagnostic[] = []
    const required = requiredPath(component, path) || protectsRequiredFields(component, path)
    if (required) {
        if (explicit && requested !== "primary") diagnostics.push({severity: "error", code: "required-editor-visibility", message: `Required inputs without declared defaults must remain primary at ${JSON.stringify(path)}`})
        visibility = "primary"
        source = "required"
        reason = "Required input without a declared default, or container of required inputs"
    }
    for (let length = 1; length < path.length; length++) {
        const ancestorPath = path.slice(0, length)
        const ancestor = component.editorRules?.find(rule => pathEquals(rule.path, ancestorPath))
        if (ancestor?.editor.visibility !== "hidden") continue
        if (requiredPath(component, ancestorPath) || protectsRequiredFields(component, ancestorPath)) continue
        visibility = "hidden"
        source = "ancestor"
        reason = `Parent ${JSON.stringify(ancestorPath)} is hidden`
        break
    }
    return {visibility, source, reason, diagnostics,
        ...(exact?.editor.group !== undefined ? {group: exact.editor.group} : {}),
        ...(exact?.editor.label !== undefined ? {label: exact.editor.label} : {})}
}
