import type {ComponentMetadata, MetadataDocument, ValueJson} from "@reactive-forge/schema"
import {CompositionDocument, CompositionInstance, CompositionNode, CompositionPropValue} from "./composition.js"

// Composition-to-TSX export (gate E, see docs/claude-handoff.md section E and
// docs/development-plan.md's architecture diagram: "later: React source
// export"). Pure source-text generation - no compiler dependency (no
// ts-morph/typescript/esbuild), deliberately, so this can live in
// @reactive-forge/runtime without breaking its "browser runtime independent
// of compiler tooling" contract (docs/baseline.md, "Runtime (gate D, part
// 1)": "Depends only on @reactive-forge/schema and react - no ts-morph/
// typescript/esbuild"). Turning a ValueJson into TSX-embeddable source text
// is ordinary string templating, not type analysis, so no compiler package is
// needed to do it.
//
// Scope: exporter only. No CMS/design-tool integration, no file-writing/CLI
// wiring - exportToTsx returns a source-text string; what the caller does
// with it (write to disk, feed to a build step, hand to an editor "export"
// button) is out of scope here, per the handoff's explicit instruction not
// to invent an integration target.

export interface ExportOptions {
    /**
     * Name of the exported component function. Default: "ExportedComposition".
     */
    exportedComponentName?: string
    /**
     * Maps a referenced component's `ComponentMetadata` to the module
     * specifier the generated import statement should use. `sourcePath` is
     * project-root-relative (see docs/metadata-contract.md), matching
     * `packages/codegen/src/generate.ts`'s existing convention of resolving
     * imports relative to a known root - but the exporter itself has no
     * `rootDir`/output-file location, so it cannot compute a correct
     * relative path on its own. The default assumes the exported file will
     * live directly next to the project root the metadata was generated
     * against (`sourcePath` with its extension stripped and a leading "./"
     * if it doesn't already have a relative prefix). Pass a resolver to
     * place the exported file elsewhere.
     */
    resolveImportPath?: (component: ComponentMetadata) => string
    /**
     * Name of the prop the exported component accepts for resolving
     * `"callback"`-kind prop values at render time. Default: "callbacks".
     * See the module doc comment below for the callback-reference
     * convention this implements.
     */
    callbacksParamName?: string
}

/**
 * Renders a `CompositionDocument` back into TSX source text: import
 * statements for every distinct component the tree references (resolved
 * through `metadata`, mirroring `packages/codegen/src/generate.ts`'s
 * default-vs-named import convention), and a single exported component whose
 * JSX body mirrors the composition tree exactly - nested elements for
 * `CompositionInstance` nesting, `{"text"}` expressions for
 * `CompositionText`, `{null}` for `CompositionVoid`.
 *
 * Prop values: a `"value"` prop's `ValueJson` becomes a JSX attribute with an
 * appropriate literal/expression (`title="Greetings"` for a plain string,
 * `{5}` for a number, `{123n}` for a bigint, `{new Date("...")}` for a date,
 * `{[1, 2, 3]}` for an array, `{{key: "value"}}` for an object). A `"value"`
 * prop whose `ValueJson` is the `"element"` variant (a single nested-
 * component reference embedded in an ordinary prop, not a composition
 * child) becomes a nested JSX expression, resolved the same way
 * `packages/runtime/src/render.ts`'s `resolveElementReference` resolves it
 * at render time (metadata `sourcePath`/`name` lookup), except emitted as
 * source text instead of a real element.
 *
 * Callback references (development-plan point 4: "Persist callback
 * references, not function bodies" - a composition document never carries a
 * function body, and this exporter does not invent one either): the
 * exported component accepts a `callbacks` prop (see `ExportOptions.
 * callbacksParamName`) typed `Record<string, (...args: any[]) => unknown>`,
 * and a `{kind: "callback", name}` prop value becomes `prop={callbacks.name}`
 * (or `callbacks["name"]` if `name` isn't a valid identifier). The exported
 * file compiles and typechecks with zero fabricated callback logic - the
 * host that renders the exported component is responsible for supplying the
 * same callback registry it would otherwise pass to
 * `renderComposition`'s `RenderOptions.callbacks`.
 *
 * Does not validate `doc` against a `ComponentLibraryData` (this is a static
 * export - no loaded components are required, per the function's minimal
 * input contract). It does resolve every referenced component id against
 * `metadata`, and throws a plain `Error` (not a `CompositionDiagnostic`) if
 * an id has no corresponding `ComponentMetadata` entry, since the exporter
 * cannot produce a valid import for a component it cannot identify. Callers
 * that want full structural validation (missing required props, wrong-typed
 * values, unresolved callbacks) first should run `validateComposition` from
 * `./validate.js` - the same function `renderComposition` uses - before
 * exporting.
 */
export function exportToTsx(doc: CompositionDocument, metadata: MetadataDocument, options: ExportOptions = {}): string {
    const schemaVersion: number = doc.schemaVersion
    if (schemaVersion !== 1) throw new Error(`exportToTsx: unsupported composition schemaVersion: ${String(schemaVersion)}`)

    const exportedComponentName = options.exportedComponentName ?? "ExportedComposition"
    const callbacksParamName = options.callbacksParamName ?? "callbacks"
    const resolveImportPath = options.resolveImportPath ?? defaultResolveImportPath

    const referencedIds = new Set<string>()
    collectNodeComponentIds(doc.root, referencedIds, metadata)
    const imports = buildImportTable(referencedIds, metadata)

    const importLines = [...imports.values()]
        .sort((a, b) => a.localName.localeCompare(b.localName))
        .map(entry => formatImportStatement(entry, resolveImportPath))

    const bodyJsx = renderInstanceJsx(doc.root, metadata, imports, callbacksParamName, 2)

    const lines = [
        "// Generated by @reactive-forge/runtime's exportToTsx. Do not edit.",
        ...importLines,
        "",
        `export default function ${exportedComponentName}(`,
        `    { ${callbacksParamName} }: { ${callbacksParamName}: Record<string, (...args: any[]) => unknown> }`,
        `) {`,
        `    return (`,
        `        ${bodyJsx}`,
        `    )`,
        `}`,
        ""
    ]
    return lines.join("\n")
}

interface ImportEntry {
    meta: ComponentMetadata
    localName: string
}

function defaultResolveImportPath(component: ComponentMetadata): string {
    const withoutExtension = component.sourcePath.replace(/\.(tsx?|jsx?)$/i, "")
    return withoutExtension.startsWith(".") ? withoutExtension : `./${withoutExtension}`
}

function findComponentMeta(metadata: MetadataDocument, id: string): ComponentMetadata {
    const meta = metadata.components.find(component => component.id === id)
    if (meta === undefined) throw new Error(`exportToTsx: no component with id "${id}" in the metadata document`)
    return meta
}

function findComponentMetaByIdentity(metadata: MetadataDocument, sourcePath: string, name: string): ComponentMetadata {
    const meta = metadata.components.find(component => component.sourcePath === sourcePath && component.name === name)
    if (meta === undefined) throw new Error(`exportToTsx: no component metadata matches element reference "${sourcePath}#${name}"`)
    return meta
}

// Walks a single ValueJson value for nested "element" references (which may
// be nested arbitrarily deep inside array/object values), collecting the
// referenced component's stable metadata id so it gets an import statement
// too.
function collectValueComponentIds(value: ValueJson, ids: Set<string>, metadata: MetadataDocument): void {
    switch (value.type) {
        case "array":
            for (const item of value.value) collectValueComponentIds(item, ids, metadata)
            return
        case "object":
            for (const item of Object.values(value.value)) collectValueComponentIds(item, ids, metadata)
            return
        case "element": {
            const meta = findComponentMetaByIdentity(metadata, value.value.path, value.value.name)
            ids.add(meta.id)
            for (const arg of Object.values(value.value.args)) collectValueComponentIds(arg, ids, metadata)
            return
        }
        default:
            return
    }
}

function collectNodeComponentIds(node: CompositionNode, ids: Set<string>, metadata: MetadataDocument): void {
    if (node.kind !== "instance") return
    ids.add(node.id)
    for (const propValue of Object.values(node.props)) {
        if (propValue.kind === "value") collectValueComponentIds(propValue.value, ids, metadata)
    }
    for (const child of node.children ?? []) collectNodeComponentIds(child, ids, metadata)
}

function sanitizeIdentifier(name: string): string {
    let result = name.replace(/[^A-Za-z0-9_$]/g, "_")
    if (result === "" || !/^[A-Za-z_$]/.test(result)) result = `_${result}`
    return result
}

// Builds the id -> {meta, localName} import table, deterministically
// (sorted by id) and collision-free: two distinct components that would
// otherwise sanitize to the same local identifier (same public name from
// different source files, or an unusual quoted export name) get their
// stable id appended to disambiguate.
function buildImportTable(ids: Set<string>, metadata: MetadataDocument): Map<string, ImportEntry> {
    const usedNames = new Set<string>()
    const table = new Map<string, ImportEntry>()
    for (const id of [...ids].sort()) {
        const meta = findComponentMeta(metadata, id)
        let localName = sanitizeIdentifier(meta.name)
        if (usedNames.has(localName)) localName = sanitizeIdentifier(`${meta.name}_${meta.id}`)
        usedNames.add(localName)
        table.set(id, {meta, localName})
    }
    return table
}

const validIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function formatImportStatement(entry: ImportEntry, resolveImportPath: (component: ComponentMetadata) => string): string {
    const specifier = JSON.stringify(resolveImportPath(entry.meta))
    if (entry.meta.isDefault) return `import ${entry.localName} from ${specifier}`
    const importedName = validIdentifierPattern.test(entry.meta.name) ? entry.meta.name : JSON.stringify(entry.meta.name)
    const binding = entry.meta.name === entry.localName ? entry.localName : `${importedName} as ${entry.localName}`
    return `import { ${binding} } from ${specifier}`
}

function serializeNumberLiteral(value: number): string {
    if (Number.isNaN(value)) return "NaN"
    if (value === Infinity) return "Infinity"
    if (value === -Infinity) return "-Infinity"
    return JSON.stringify(value)
}

function serializeObjectExpression(value: Record<string, ValueJson>, imports: Map<string, ImportEntry>, metadata: MetadataDocument): string {
    const entries = Object.entries(value).map(([key, item]) => {
        const keyText = validIdentifierPattern.test(key) ? key : JSON.stringify(key)
        return `${keyText}: ${serializeValueExpression(item, imports, metadata)}`
    })
    return `{${entries.join(", ")}}`
}

function serializeElementExpression(element: {path: string, name: string, args: Record<string, ValueJson>}, imports: Map<string, ImportEntry>, metadata: MetadataDocument): string {
    const meta = findComponentMetaByIdentity(metadata, element.path, element.name)
    const entry = imports.get(meta.id)
    if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for component id "${meta.id}"`)
    const attributes = Object.entries(element.args)
        .map(([name, argValue]) => serializePropFragment(name, {kind: "value", value: argValue}, imports, metadata, ""))
        .join(" ")
    return `<${entry.localName}${attributes ? ` ${attributes}` : ""} />`
}

// Turns a single ValueJson into a bare JS expression's source text (no
// surrounding `{}`) - used both for a JSX attribute's expression container
// and for array/object element values.
function serializeValueExpression(value: ValueJson, imports: Map<string, ImportEntry>, metadata: MetadataDocument): string {
    switch (value.type) {
        case "void":
        case "undefined":
            return "undefined"
        case "null":
            return "null"
        case "boolean":
            return String(value.value)
        case "number":
            return serializeNumberLiteral(value.value)
        case "bigint":
            return `${value.value}n`
        case "string":
            return JSON.stringify(value.value)
        case "date":
            return `new Date(${JSON.stringify(value.value)})`
        case "array":
            return `[${value.value.map(item => serializeValueExpression(item, imports, metadata)).join(", ")}]`
        case "object":
            return serializeObjectExpression(value.value, imports, metadata)
        case "element":
            return serializeElementExpression(value.value, imports, metadata)
    }
}

function serializeCallbackExpression(name: string, callbacksParamName: string): string {
    return validIdentifierPattern.test(name) ? `${callbacksParamName}.${name}` : `${callbacksParamName}[${JSON.stringify(name)}]`
}

// Plain JSX attribute names are restricted to JSXIdentifier syntax (letters/
// digits/"-"/"_", no arbitrary strings) - unlike an object property name, a
// prop coming from an unusual quoted export/prop name can't always be
// spelled as `name={...}` directly. Falls back to a spread of a single
// computed key in that rare case, which is always valid regardless of the
// prop name's shape.
const jsxAttributeNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/

function serializePropFragment(propName: string, propValue: CompositionPropValue, imports: Map<string, ImportEntry>, metadata: MetadataDocument, callbacksParamName: string): string {
    const exprText = propValue.kind === "callback"
        ? serializeCallbackExpression(propValue.name, callbacksParamName)
        : serializeValueExpression(propValue.value, imports, metadata)

    if (!jsxAttributeNamePattern.test(propName))
        return `{...{ ${JSON.stringify(propName)}: ${exprText} }}`

    // A bare JSX string-literal attribute (`name="text"`) only for a plain
    // string value containing none of the characters that would need
    // escaping inside a JSX string-literal attribute (JSX's own limited
    // string-attribute grammar, not a JS string literal's escaping rules) -
    // everything else, including every other ValueJson kind, uses an
    // expression container.
    if (propValue.kind === "value" && propValue.value.type === "string" && /^[^"<>{}\r\n\\]*$/.test(propValue.value.value))
        return `${propName}="${propValue.value.value}"`

    return `${propName}={${exprText}}`
}

function renderChildJsx(node: CompositionNode, metadata: MetadataDocument, imports: Map<string, ImportEntry>, callbacksParamName: string, indentLevel: number): string {
    switch (node.kind) {
        case "text":
            return `{${JSON.stringify(node.value)}}`
        case "void":
            return "{null}"
        case "instance":
            return renderInstanceJsx(node, metadata, imports, callbacksParamName, indentLevel)
    }
}

function renderInstanceJsx(node: CompositionInstance, metadata: MetadataDocument, imports: Map<string, ImportEntry>, callbacksParamName: string, indentLevel: number): string {
    const meta = findComponentMeta(metadata, node.id)
    const entry = imports.get(meta.id)
    if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for component id "${meta.id}"`)

    const propFragments = Object.entries(node.props)
        .filter(([name]) => name !== "children")
        .map(([name, value]) => serializePropFragment(name, value, imports, metadata, callbacksParamName))
    const openTag = `<${entry.localName}${propFragments.length > 0 ? ` ${propFragments.join(" ")}` : ""}`

    const children = node.children ?? []
    if (children.length === 0) return `${openTag} />`

    const indent = "    ".repeat(indentLevel + 1)
    const closingIndent = "    ".repeat(indentLevel)
    const childrenSrc = children
        .map(child => indent + renderChildJsx(child, metadata, imports, callbacksParamName, indentLevel + 1))
        .join("\n")
    return `${openTag}>\n${childrenSrc}\n${closingIndent}</${entry.localName}>`
}
