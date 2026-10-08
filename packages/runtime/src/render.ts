import {cloneElement, createElement, Fragment, isValidElement, ReactElement, ReactNode} from "react"
import {
    ArraySchema,
    ComponentIdentity,
    componentIdentityEquals,
    ComponentLibraryData,
    ComponentMetadata,
    findComponentEntry,
    fromValueJson,
    isPathResolutionDiagnostic,
    MetadataDocument,
    ObjectSchema,
    resolveSegment,
    resolveSlotPolicy,
    Schema,
    schemaFromJson,
    SlotPath,
    stripNullish,
    UnionSchema,
    ValueConstruct
} from "@reactive-forge/schema"
import {CompositionDocument, CompositionDocumentV1, CompositionDocumentV2, CompositionInstance, CompositionSlotItem, CompositionValue} from "./composition.js"
import {CompositionDiagnostic, validateComposition} from "./validate.js"
import {resolveCompositionProps} from "./props.js"
import {decodeAdapterValue} from "./adapters.js"
import {toValueJson} from "@reactive-forge/schema"
import {evaluateExpression, evaluateLocals, EvaluationScope} from "./expressions.js"

/**
 * Host-supplied bindings a rendered composition's `"callback"` prop values resolve against. Never
 * populated from the composition document itself - only the caller of `renderComposition` supplies
 * it, per-render.
 */
export type CallbackRegistry = Record<string, (...args: unknown[]) => unknown>

export interface RenderOptions {
    valueAdapters?: import("@reactive-forge/schema").ValueAdapterRegistry
    callbacks?: CallbackRegistry
    props?: Record<string, unknown>
}

export class CompositionValidationError extends Error {
    readonly diagnostics: CompositionDiagnostic[]

    constructor(diagnostics: CompositionDiagnostic[]) {
        super(`Invalid composition document:\n${diagnostics.map(d => `  [${d.severity}] ${d.path}: ${d.code} - ${d.message}`).join("\n")}`)
        this.name = "CompositionValidationError"
        this.diagnostics = diagnostics
    }
}

function findMetadata(metadata: MetadataDocument, id: string): ComponentMetadata {
    const found = metadata.components.find(component => component.id === id)
    if (found === undefined) throw new Error(`No component with id "${id}" in the metadata document (should have been caught by validateComposition)`)
    return found
}

// Resolves a `ValueJson`/`ValueConstruct` "element" reference. Only ever reachable from a
// `PropMetadata.defaultValue`/`exampleValue`-style construct, never from a validated v3 "leaf"
// CompositionValue (docs/slot-contract-recursive.md section 1.4: a "leaf" may never contain
// "element" - `containsLegacyElement` in validate.ts rejects it upstream). Kept, unreachable from
// any v3-validated document, per section 5's table note - not removed outright.
function resolveElementReference(
    element: {path: string, name: string, args: Record<string, ValueConstruct>},
    metadata: MetadataDocument,
    library: ComponentLibraryData
): ReactElement {
    const meta = metadata.components.find(c => c.sourcePath === element.path && c.name === element.name)
    if (meta === undefined) throw new Error(`No component metadata matches element reference "${element.path}#${element.name}"`)
    const entry = findComponentEntry(library, meta.id)
    if (entry === undefined) throw new Error(`No registry entry for component id "${meta.id}" ("${element.path}#${element.name}")`)

    const props: Record<string, unknown> = {}
    for (const [propName, propValue] of Object.entries(element.args))
        props[propName] = constructToJs(propValue, metadata, library)
    return createElement(entry.component, props)
}

function constructToJs(construct: ValueConstruct, metadata: MetadataDocument, library: ComponentLibraryData): unknown {
    switch (construct.type) {
        case "instance": return decodeAdapterValue(toValueJson(construct), library.valueAdapters)
        case "void":
        case "undefined":
            return undefined
        case "null":
            return null
        case "boolean":
        case "number":
        case "string":
        case "bigint":
            return construct.value
        case "date":
            return new Date(construct.value)
        case "array":
            return construct.value.map(value => constructToJs(value, metadata, library))
        case "object": {
            const result: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(construct.value)) result[key] = constructToJs(value, metadata, library)
            return result
        }
        case "element":
            return resolveElementReference(construct.value, metadata, library)
        case "function":
            throw new Error("Unreachable: a validated composition document never produces a FunctionConstruct prop value")
    }
}

function renderSlotItem(item: CompositionSlotItem, metadata: MetadataDocument, library: ComponentLibraryData, callbacks: CallbackRegistry, scope: EvaluationScope): ReactNode {
    switch (item.kind) {
        case "text":
            return item.value
        case "void":
            return null
        case "instance":
            return renderInstance(item.instance, metadata, library, callbacks, scope)
    }
}

// Renders a "nodes" value found at `path` (a top-level prop, a nested object field, or a "nodes"-
// kind array entry - docs/slot-contract-recursive.md section 5): each CompositionSlotItem in
// order, wrapped in a Fragment when items.length !== 1 or the resolved policy is multiple:true.
// Resolves its OWN rule directly via `resolveSlotPolicy(componentMeta, path)` at its own exact
// path - the direct generalization of v2's `resolvePropSlotRules`-based lookup, now correct at any
// depth (an array entry's own "nodes" node is checked against ITS OWN maxItems, independent of any
// sibling entry - section 1.3/8.3).
function renderNodesValue(
    componentMeta: ComponentMetadata,
    path: SlotPath,
    items: CompositionSlotItem[],
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry,
    scope: EvaluationScope
): ReactNode {
    const rendered = items.map(item => renderSlotItem(item, metadata, library, callbacks, scope))
    const rule = resolveSlotPolicy(componentMeta, path)
    const multiple = rule?.slot !== undefined && "multiple" in rule.slot && rule.slot.multiple === true
    if (rendered.length === 1 && !multiple) return rendered[0]
    return createElement(Fragment, null, ...rendered)
}

// Real bug fixed (phase 4 demo work surfaced it): this previously threw for any non-project
// identity, even though `checkSlotValue`/`validateComposition` (packages/schema) already resolve
// external `componentRef` identities against `context.library` correctly (see SlotCheck.ts). See
// the original doc comment (unchanged reasoning in v3).
function resolveComponentRef(identity: ComponentIdentity, library: ComponentLibraryData, metadata: MetadataDocument): unknown {
    if (identity.source === "project") {
        const entry = findComponentEntry(library, identity.id)
        if (entry === undefined) throw new Error(`No registry entry for componentRef id "${identity.id}" (should have been caught by validateComposition)`)
        return entry.component
    }
    const componentMeta = metadata.components.find(c => c.external !== undefined && componentIdentityEquals(c.external, identity))
    if (componentMeta === undefined)
        throw new Error(`No metadata entry for external componentRef identity (package "${identity.package}", export "${identity.exportName}")`)
    const entry = findComponentEntry(library, componentMeta.id)
    if (entry === undefined)
        throw new Error(`No registry entry for external component "${componentMeta.id}" (package "${identity.package}", export "${identity.exportName}") - the host application must register the real component in ComponentLibraryData`)
    return entry.component
}

/**
 * The recursive renderer, docs/slot-contract-recursive.md section 2.4/5 - the SAME dispatch shape
 * as `validateCompositionValue` (validate.ts), producing a JS value instead of diagnostics. Never
 * re-validates; only ever called after `validateComposition` has already passed (trusting the tree
 * shape validation already confirmed, exactly as v2 did).
 */
function renderCompositionValue(
    componentMeta: ComponentMetadata,
    path: SlotPath,
    schema: Schema,
    value: CompositionValue,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry,
    scope: EvaluationScope
): unknown {
    switch (value.kind) {
        case "prop": return scope.props[value.name]
        case "leaf": {
            const construct = fromValueJson(stripNullish(schema), value.value)
            try { return constructToJs(construct, metadata, library) }
            catch (error) {
                throw new CompositionValidationError([{severity: "error", code: "value-construction-failed", path: `${componentMeta.id}.${JSON.stringify(path)}`,
                    message: error instanceof Error ? error.message : String(error)}])
            }
        }
        case "nodes":
            return renderNodesValue(componentMeta, path, value.value.items, metadata, library, callbacks, scope)
        case "componentRef":
            return resolveComponentRef(value.value, library, metadata)
        case "object": {
            const stripped = stripNullish(schema)
            if (!(stripped instanceof ObjectSchema)) throw new Error(`renderComposition: internal error - expected an ObjectSchema at a validated "object" CompositionValue`)
            const result: Record<string, unknown> = {}
            for (const [key, childValue] of Object.entries(value.fields)) {
                const childSchema = resolveSegment(stripped, key)
                if (isPathResolutionDiagnostic(childSchema)) throw new Error(`renderComposition: internal error - unresolvable field "${key}" on a validated "object" CompositionValue`)
                result[key] = renderCompositionValue(componentMeta, [...path, key], childSchema, childValue, metadata, library, callbacks, scope)
            }
            return result
        }
        case "array": {
            const stripped = stripNullish(schema)
            if (!(stripped instanceof ArraySchema)) throw new Error(`renderComposition: internal error - expected an ArraySchema at a validated "array" CompositionValue`)
            const elementSchema = resolveSegment(stripped, {kind: "each"})
            if (isPathResolutionDiagnostic(elementSchema)) throw new Error(`renderComposition: internal error - unresolvable element schema on a validated "array" CompositionValue`)
            return value.items.map(item => {
                const rendered = renderCompositionValue(componentMeta, [...path, {kind: "each"}], elementSchema, item.value, metadata, library, callbacks, scope)
                return isValidElement(rendered) ? cloneElement(rendered, {key: item.itemId}) : rendered
            })
        }
        case "expression":
            return evaluateExpression(value.expression, scope, library.valueAdapters)
        case "variant": {
            const stripped = stripNullish(schema)
            if (!(stripped instanceof UnionSchema)) throw new Error(`renderComposition: internal error - expected a UnionSchema at a validated "variant" CompositionValue`)
            const memberSchema = resolveSegment(stripped, {kind: "variant", prop: value.selector.prop, equals: value.selector.equals})
            if (isPathResolutionDiagnostic(memberSchema)) throw new Error(`renderComposition: internal error - unresolvable variant member on a validated "variant" CompositionValue`)
            return renderCompositionValue(componentMeta, [...path, {kind: "variant", prop: value.selector.prop, equals: value.selector.equals}], memberSchema, value.value, metadata, library, callbacks, scope)
        }
    }
}

function renderInstance(node: CompositionInstance, metadata: MetadataDocument, library: ComponentLibraryData, callbacks: CallbackRegistry, scope: EvaluationScope, key?: number): ReactElement {
    const componentMeta = findMetadata(metadata, node.componentId)
    const entry = findComponentEntry(library, node.componentId)
    if (entry === undefined) throw new Error(`No registry entry with id "${node.componentId}" (should have been caught by validateComposition)`)

    const props: Record<string, unknown> = {}
    for (const [propName, propMeta] of Object.entries(componentMeta.props)) {
        const provided = node.props[propName]
        if (provided === undefined) continue
        if (provided.kind === "prop") {
            props[propName] = scope.props[provided.name]
            continue
        }
        if (provided.kind === "callback") {
            props[propName] = callbacks[provided.name]
            continue
        }
        const schema = schemaFromJson(propMeta.schema)
        props[propName] = renderCompositionValue(componentMeta, [propName], schema, provided.value, metadata, library, callbacks, scope)
    }

    if (key !== undefined) props["key"] = key
    return createElement(entry.component, props)
}

/**
 * Validates `doc` (throwing `CompositionValidationError` with the full diagnostic list if invalid)
 * and renders it into a real, nested React element tree. Accepts `CompositionDocument |
 * CompositionDocumentV2 | CompositionDocumentV1` at the type level so a bare v1/v2 document handed
 * here surfaces the `"unsupported-schema-version"` diagnostic (via `validateComposition`) instead
 * of failing to compile - see composition.ts's versioning doc comment.
 */
export function renderComposition(
    doc: CompositionDocument | CompositionDocumentV2 | CompositionDocumentV1,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    options: RenderOptions = {}
): ReactElement {
    if (options.valueAdapters) library = {...library, valueAdapters: {...library.valueAdapters, ...options.valueAdapters}}
    const callbacks = options.callbacks ?? {}
    const result = validateComposition(doc, metadata, library, callbacks, options.props ?? {})
    if (!result.valid) throw new CompositionValidationError(result.diagnostics)
    const document = doc as CompositionDocument
    const props = resolveCompositionProps(document, options.props ?? {}, library)
    const locals = document.schemaVersion === 6 ? evaluateLocals(document.locals, props, library.valueAdapters) : {}
    return renderInstance(document.root, metadata, library, callbacks, {props, locals})
}
