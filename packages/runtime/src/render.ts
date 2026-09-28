import {createElement, Fragment, ReactElement, ReactNode} from "react"
import {
    ComponentIdentity,
    componentIdentityEquals,
    ComponentLibraryData,
    ComponentMetadata,
    findComponentEntry,
    fromValueJson,
    MetadataDocument,
    RichTextBlockNode,
    RichTextTextNode,
    RichTextValueJson,
    schemaFromJson,
    ValueConstruct
} from "@reactive-forge/schema"
import {CompositionDocument, CompositionDocumentV1, CompositionInstance, CompositionSlotItem} from "./composition.js"
import {CompositionDiagnostic, resolvePropSlotRules, validateComposition} from "./validate.js"

/**
 * Host-supplied bindings a rendered composition's `"callback"` prop values resolve against. Never
 * populated from the composition document itself - only the caller of `renderComposition` supplies
 * it, per-render.
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

// Resolves a `ValueJson`/`ValueConstruct` "element" reference (a single nested-component reference
// embedded in an ordinary prop value, distinct from a "nodes"-kind slot) into a real, rendered
// React element. Unchanged from v1 - still resolved via sourcePath/name metadata lookup.
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

// Fixed, non-overridable rich-text renderer, docs/slot-contract.md section 9: RichTextTextNode ->
// text wrapped in <strong>/<em> per its marks (nested in mark order, deterministic),
// RichTextParagraphNode -> <p>, list nodes -> <ul>/<ol> with <li> children. A small, fixed mapping
// - never configurable - so it can never become an injection point.
function renderRichTextTextNode(node: RichTextTextNode, key?: number): ReactNode {
    let content: ReactNode = node.text
    // Nested in mark order: the innermost wrap is the *last* mark in node.marks, so marks read
    // left-to-right as "outermost to innermost" - deterministic given RichTextMark is a plain array.
    for (let i = node.marks.length - 1; i >= 0; i--) {
        const mark = node.marks[i]
        if (mark === "bold") content = createElement("strong", null, content)
        else if (mark === "italic") content = createElement("em", null, content)
    }
    return key !== undefined ? createElement(Fragment, {key}, content) : content
}

function renderRichTextBlockNode(node: RichTextBlockNode, key: number): ReactNode {
    if (node.type === "paragraph")
        return createElement("p", {key}, node.children.map((child, i) => renderRichTextTextNode(child, i)))
    const tag = node.type === "bulletList" ? "ul" : "ol"
    return createElement(tag, {key}, node.items.map((item, i) =>
        createElement("li", {key: i}, item.children.map((child, j) => renderRichTextTextNode(child, j)))))
}

function renderRichText(value: RichTextValueJson): ReactNode {
    if (value.inline) return value.nodes.map((node, i) => renderRichTextTextNode(node, i))
    return value.nodes.map((node, i) => renderRichTextBlockNode(node, i))
}

function renderSlotItem(item: CompositionSlotItem, metadata: MetadataDocument, library: ComponentLibraryData, callbacks: CallbackRegistry): ReactNode {
    switch (item.kind) {
        case "text":
            return item.value
        case "void":
            return null
        case "instance":
            return renderInstance(item.instance, metadata, library, callbacks)
    }
}

// Renders a "nodes" prop value: each CompositionSlotItem in order, wrapped in a Fragment when
// items.length !== 1 or the resolved policy is multiple:true (docs/slot-contract.md section 9).
function renderSlotValue(
    propName: string,
    componentMeta: ComponentMetadata,
    items: CompositionSlotItem[],
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry
): ReactNode {
    const rendered = items.map(item => renderSlotItem(item, metadata, library, callbacks))
    const rules = resolvePropSlotRules(componentMeta, propName)
    const multiple = rules.itemRule?.slot !== undefined && "multiple" in rules.itemRule.slot && rules.itemRule.slot.multiple === true
    if (rendered.length === 1 && !multiple) return rendered[0]
    return createElement(Fragment, null, ...rendered)
}

// Real bug fixed (phase 4 demo work surfaced it): this previously threw for any non-project
// identity, even though `checkSlotValue`/`validateComposition` (packages/schema) already resolve
// external `componentRef` identities against `context.library` correctly (see SlotCheck.ts). A
// project identity's `id` is exactly `ComponentEntry.id`, so it resolves directly. An external
// identity has no such id of its own (docs/slot-contract.md section 5's `ExternalComponentIdentity`
// carries package/subpath/exportName, not a precomputed hash) - `packages/runtime` must not
// duplicate codegen's external-id hash formula (the same one-shared-computation principle
// `componentId()` enforces for project ids), so it instead finds the `ComponentMetadata` entry
// whose own `.external` field structurally matches (already present in `metadata`, no new
// dependency), then looks up THAT entry's stable `id` in the registry - the same id the host
// application is expected to register the real component under (see
// tests/fixtures/editor-demo/demo.tsx's `withExternalLibraryEntries`).
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

function renderInstance(node: CompositionInstance, metadata: MetadataDocument, library: ComponentLibraryData, callbacks: CallbackRegistry, key?: number): ReactElement {
    const componentMeta = findMetadata(metadata, node.componentId)
    const entry = findComponentEntry(library, node.componentId)
    if (entry === undefined) throw new Error(`No registry entry with id "${node.componentId}" (should have been caught by validateComposition)`)

    const props: Record<string, unknown> = {}
    for (const [propName, propMeta] of Object.entries(componentMeta.props)) {
        const provided = node.props[propName]
        if (provided === undefined) continue
        switch (provided.kind) {
            case "callback":
                props[propName] = callbacks[provided.name]
                break
            case "componentRef":
                props[propName] = resolveComponentRef(provided.value, library, metadata)
                break
            case "richText":
                props[propName] = renderRichText(provided.value)
                break
            case "nodes":
                props[propName] = renderSlotValue(propName, componentMeta, provided.value.items, metadata, library, callbacks)
                break
            case "value": {
                const schema = schemaFromJson(propMeta.schema)
                const construct = fromValueJson(schema, provided.value)
                props[propName] = constructToJs(construct, metadata, library)
                break
            }
        }
    }

    if (key !== undefined) props["key"] = key
    return createElement(entry.component, props)
}

/**
 * Validates `doc` (throwing `CompositionValidationError` with the full diagnostic list if invalid)
 * and renders it into a real, nested React element tree. Accepts `CompositionDocument |
 * CompositionDocumentV1` at the type level so a bare v1 document handed here surfaces the
 * `"unsupported-schema-version"` diagnostic (via `validateComposition`) instead of failing to
 * compile - see composition.ts's versioning doc comment.
 */
export function renderComposition(
    doc: CompositionDocument | CompositionDocumentV1,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    options: RenderOptions = {}
): ReactElement {
    const callbacks = options.callbacks ?? {}
    const result = validateComposition(doc, metadata, library, callbacks)
    if (!result.valid) throw new CompositionValidationError(result.diagnostics)
    return renderInstance((doc as CompositionDocument).root, metadata, library, callbacks)
}
