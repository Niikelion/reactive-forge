import {createElement, ReactElement, ReactNode} from "react"
import {
    ComponentLibraryData,
    ComponentMetadata,
    findComponentEntry,
    fromValueJson,
    MetadataDocument,
    schemaFromJson,
    ValueConstruct
} from "@reactive-forge/schema"
import {CompositionDocument, CompositionInstance, CompositionNode} from "./composition.js"
import {CompositionDiagnostic, validateComposition} from "./validate.js"

/**
 * Host-supplied bindings a rendered composition's `"callback"` prop values
 * resolve against (development-plan point 4: "Persist callback references,
 * not function bodies"). Never populated from the composition document
 * itself - only the caller of `renderComposition` supplies it, per-render.
 */
export type CallbackRegistry = Record<string, (...args: unknown[]) => unknown>

export interface RenderOptions {
    callbacks?: CallbackRegistry
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

// Resolves a `ValueJson`/`ValueConstruct` "element" reference (a single
// nested-component reference embedded in an ordinary prop value, per
// docs/metadata-contract.md's ValueJson - distinct from a composition node's
// own `children` array) into a real, rendered React element. Identity here
// is still `sourcePath`/`name`, exactly as ValueJson's frozen "element"
// variant carries it (packages/schema/src/schema/ValueJson.ts is out of this
// gate's file-ownership scope) - resolved to the stable metadata `id` via a
// metadata lookup, then to the registry the same way every other lookup in
// this module works.
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

// Converts a validated `ValueConstruct` into a plain JS value suitable for a
// real React prop (as opposed to the JSON-safe `ValueJson` it was decoded
// from). Functions never reach here - a validated composition document only
// carries `"callback"` prop values through `CompositionPropValue`, resolved
// separately in `resolvePropValue` below, never through `ValueJson`/
// `ValueConstruct` (which excludes "function" entirely, see ValueJson.ts).
function constructToJs(construct: ValueConstruct, metadata: MetadataDocument, library: ComponentLibraryData): unknown {
    switch (construct.type) {
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

function renderChild(node: CompositionNode, metadata: MetadataDocument, library: ComponentLibraryData, callbacks: CallbackRegistry, key: number): ReactNode {
    switch (node.kind) {
        case "text":
            return node.value
        case "void":
            return null
        case "instance":
            return renderInstance(node, metadata, library, callbacks, key)
    }
}

function renderInstance(node: CompositionInstance, metadata: MetadataDocument, library: ComponentLibraryData, callbacks: CallbackRegistry, key?: number): ReactElement {
    const componentMeta = findMetadata(metadata, node.id)
    const entry = findComponentEntry(library, node.id)
    if (entry === undefined) throw new Error(`No registry entry with id "${node.id}" (should have been caught by validateComposition)`)

    const props: Record<string, unknown> = {}
    for (const [propName, propMeta] of Object.entries(componentMeta.props)) {
        if (propName === "children") continue
        const provided = node.props[propName]
        if (provided === undefined) continue
        if (provided.kind === "callback") {
            props[propName] = callbacks[provided.name]
        } else {
            const schema = schemaFromJson(propMeta.schema)
            const construct = fromValueJson(schema, provided.value)
            props[propName] = constructToJs(construct, metadata, library)
        }
    }

    const children = node.children ?? []
    if (children.length > 0) {
        const rendered = children.map((child, index) => renderChild(child, metadata, library, callbacks, index))
        props["children"] = rendered.length === 1 ? rendered[0] : rendered
    }

    if (key !== undefined) props["key"] = key
    return createElement(entry.component, props)
}

/**
 * Validates `doc` (throwing `CompositionValidationError` with the full
 * diagnostic list if invalid) and renders it into a real, nested React
 * element tree - `React.createElement` output, not a description of one.
 * Component ids resolve to actual `FC`s via the registry
 * (`findComponentEntry`), prop values decode from `ValueJson` back to real
 * JS via `fromValueJson`, and `"callback"` prop values resolve against
 * `options.callbacks` (see `CallbackRegistry`).
 */
export function renderComposition(
    doc: CompositionDocument,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    options: RenderOptions = {}
): ReactElement {
    const callbacks = options.callbacks ?? {}
    const result = validateComposition(doc, metadata, library, callbacks)
    if (!result.valid) throw new CompositionValidationError(result.diagnostics)
    return renderInstance(doc.root, metadata, library, callbacks)
}
