import {
    ComponentIdentity,
    ComponentLibraryData,
    ComponentMetadata,
    ExternalComponentIdentity,
    MetadataDocument,
    resolveSlotPolicy,
    Schema,
    schemaFromJson,
    SlotPath,
    ValueJson
} from "@reactive-forge/schema"
import {
    CompositionDocument,
    CompositionExpression,
    CompositionLocal,
    declaresProps,
    CompositionInstance,
    CompositionPropValue,
    CompositionSlotItem,
    CompositionValue
} from "./composition.js"
import {validateComposition} from "./validate.js"
import {CompositionValidationError} from "./render.js"
import {exportSchemaType} from "./export-types.js"
import {calledFunctions, EmitScope, emitExpression, expressionSchema, orderLocals, TypeScope} from "./expressions.js"

/** What serialization needs besides the tree: how to read a public prop, and how to write an expression. */
interface EmitContext {
    propsName: string
    expression(expression: CompositionExpression): string
}

/** Every expression a document holds, in its tree and in its locals. */
function documentExpressions(doc: CompositionDocument): CompositionExpression[] {
    const found: CompositionExpression[] = doc.schemaVersion === 6 ? Object.values(doc.locals ?? {}).map(local => local.expression) : []
    const value = (current: CompositionValue): void => {
        if (current.kind === "expression") found.push(current.expression)
        else if (current.kind === "object") Object.values(current.fields).forEach(value)
        else if (current.kind === "array") current.items.forEach(item => value(item.value))
        else if (current.kind === "variant") value(current.value)
        else if (current.kind === "nodes") current.value.items.forEach(item => { if (item.kind === "instance") instance(item.instance) })
    }
    const instance = (node: CompositionInstance): void => {
        for (const prop of Object.values(node.props)) if (prop.kind === "composed") value(prop.value)
    }
    instance(doc.root)
    return found
}

// Generates browser-safe TSX without compiler dependencies. Public inputs come exclusively
// from schemaVersion 5's explicit doc.props declarations, including unused declarations.
// Legacy callback bindings remain supported by live rendering but require explicit conversion
// before export. Nested nodes and component references add imports recursively; children render
// directly inside JSX tags, while other multi-node slots retain their Fragment boundaries.

export interface ExportOptions {
    valueAdapters?: import("@reactive-forge/schema").ValueAdapterRegistry
    /**
     * Name of the exported component function. Default: "ExportedComposition".
     */
    exportedComponentName?: string
    /**
     * Maps a referenced PROJECT component's `ComponentMetadata` to the module specifier the
     * generated import statement should use. `sourcePath` is project-root-relative (see
     * docs/metadata-contract.md), matching `packages/codegen/src/generate.ts`'s existing
     * convention of resolving imports relative to a known root - but the exporter itself has no
     * `rootDir`/output-file location, so it cannot compute a correct relative path on its own. The
     * default assumes the exported file will live directly next to the project root the metadata
     * was generated against (`sourcePath` with its extension stripped and a leading "./" if it
     * doesn't already have a relative prefix). Pass a resolver to place the exported file
     * elsewhere. Not consulted for an external component's import - that specifier is built
     * directly from `ExternalComponentIdentity.package`/`subpath` (see `formatImportStatement`
     * below), which never needs a project-relative resolution.
     */
    resolveImportPath?: (component: ComponentMetadata) => string
}

/**
 * Renders a current `CompositionDocument` back into TSX source text: import statements for every
 * distinct component the tree references - as a nested instance or a `"componentRef"` prop value
 * (project or external identity) - and a single exported component whose JSX body mirrors the
 * composition tree exactly.
 *
 * `exportToTsx` requires `library` (needed to run `validateComposition`, the exact function
 * `renderComposition` also runs before rendering) and throws `CompositionValidationError` - the
 * same error type/shape `renderComposition` throws, not a parallel one - before serializing
 * anything, so a document with a forbidden nested component, invalid public prop binding, excess
 * cardinality, or a legacy `"element"` node hidden inside a `"leaf"` value can never produce TSX
 * source text at all. Public prop declarations and references are validated structurally;
 * their runtime values are supplied by the caller of the generated component. Legacy callback
 * references are refused instead of inferring a public input.
 */
export function exportToTsx(doc: CompositionDocument, metadata: MetadataDocument, library: ComponentLibraryData, options: ExportOptions = {}): string {
    if (options.valueAdapters) library = {...library, valueAdapters: {...library.valueAdapters, ...options.valueAdapters}}
    const schemaVersion: number = doc.schemaVersion
    if (schemaVersion === 1)
        throw new Error(`exportToTsx: composition schemaVersion 1 is not accepted by the v3 exporter; call migrateCompositionDocumentV1ToV2(doc) then migrateCompositionDocumentV2ToV3(doc, metadata) first`)
    if (schemaVersion === 2)
        throw new Error(`exportToTsx: composition schemaVersion 2 is not accepted by the v3 exporter; call migrateCompositionDocumentV2ToV3(doc, metadata) first`)
    if (schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== 5 && schemaVersion !== 6)
        throw new Error(`exportToTsx: unsupported composition schemaVersion: ${String(schemaVersion)}`)

    const validation = validateComposition(doc, metadata, library)
    if (!validation.valid) throw new CompositionValidationError(validation.diagnostics)

    const exportedComponentName = options.exportedComponentName ?? "ExportedComposition"
    const resolveImportPath = options.resolveImportPath ?? defaultResolveImportPath
    const declarations = declaresProps(doc) ? doc.props : {}
    const locals = doc.schemaVersion === 6 ? doc.locals ?? {} : {}

    const referencedIdentities = new Map<ImportKey, ComponentIdentity>()
    collectInstanceComponentIds(doc.root, referencedIdentities, metadata)
    // A function an expression calls is imported like an external component.
    const functionIdentities = new Map<string, ComponentIdentity>()
    for (const name of new Set(documentExpressions(doc).flatMap(calledFunctions))) {
        const entry = library.functions?.[name]
        if (!entry) throw new Error(`exportToTsx: function ${JSON.stringify(name)} is not registered`)
        const identity: ComponentIdentity = {source: "external", package: entry.module, exportName: entry.exportName, isDefault: entry.isDefault ?? false}
        functionIdentities.set(name, identity)
        referencedIdentities.set(identityKey(identity), identity)
    }
    for (const declaration of Object.values(declarations)) {
        if (!declaration.typeSource) continue
        const {key, identity} = instanceImportKeyAndIdentity(declaration.typeSource.componentId, metadata)
        referencedIdentities.set(key, identity)
    }
    if (!isBindingIdentifier(exportedComponentName)) throw new Error(`exportToTsx: invalid exported component name ${JSON.stringify(exportedComponentName)}`)
    const imports = buildImportTable(referencedIdentities, metadata, new Set([exportedComponentName, "Exclude", "Array", "Date", "URL", "Map", "Set", "RegExp"]))
    const used = new Set([...imports.values()].map(entry => entry.localName))
    used.add(exportedComponentName)
    const propsParamName = uniqueIdentifier("props", used)
    const factories = new Map<string, ImportEntry>()
    visitInstanceValues([doc.root, ...Object.values(declarations).map(prop => prop.defaultValue)], value => {
        const key = `adapter:${value.adapterId}`
        if (imports.has(key)) return
        const adapter = findValueAdapter(value.adapterId, value.version, library.valueAdapters)
        if (!adapter.export) throw new Error(`Value adapter ${adapter.id} has no export factory`)
        const factoryKey = JSON.stringify([adapter.export.module, adapter.export.exportName, adapter.export.isDefault ?? false])
        const existing = factories.get(factoryKey)
        if (existing) { imports.set(key, existing); return }
        let localName = "createValue"
        for (let n = 1; used.has(localName); n++) localName = `createValue${String(n)}`
        used.add(localName)
        const entry: ImportEntry = {localName, identity: {source: "external", package: adapter.export.module, exportName: adapter.export.exportName, isDefault: adapter.export.isDefault ?? false}}
        imports.set(key, entry)
        factories.set(factoryKey, entry)
    })

    const importLines = [...new Set(imports.values())]
        .sort((a, b) => a.localName.localeCompare(b.localName))
        .map(entry => formatImportStatement(entry, resolveImportPath))

    const defaultAssignments: string[] = []
    const propTypes = Object.entries(declarations).map(([name, declaration]) => {
        let type: string
        if (declaration.typeSource) {
            const entry = imports.get(instanceImportKeyAndIdentity(declaration.typeSource.componentId, metadata).key)
            if (!entry) throw new Error(`exportToTsx: missing typeSource component import`)
            type = `import("react").ComponentProps<typeof ${entry.localName}>[${JSON.stringify(declaration.typeSource.propName)}]`
            if (!schemaFromJson(declaration.schema).verifyConstructType({type: "undefined", value: undefined})) type = `Exclude<${type}, undefined>`
        } else type = exportSchemaType(declaration.schema, path => resolveImportPath({sourcePath: path} as ComponentMetadata))
        if (declaration.defaultValue !== undefined) {
            // Validation already checked defaults against the declared schema. Preserve
            // literal/tuple types and class parameters that expression inference widens.
            const expression = `(${serializeValueExpression(declaration.defaultValue, imports, metadata)} as ${type})`
            defaultAssignments.push(`[${JSON.stringify(name)}]: ${propsParamName}[${JSON.stringify(name)}] === undefined ? ${expression} : ${propsParamName}[${JSON.stringify(name)}]`)
        }
        return `${JSON.stringify(name)}${declaration.required && declaration.defaultValue === undefined ? "" : "?"}: ${type}`
    })
    const resolvedPropsName = defaultAssignments.length ? uniqueIdentifier("values", used) : propsParamName
    // Locals become consts, in dependency order, named after the local where the name is free.
    const localNames = new Map(orderLocals(locals).map(name => [name, uniqueIdentifier(sanitizeIdentifier(name), used)]))
    const localTypes = new Map<string, Schema>()
    const types: TypeScope = {
        prop: name => Object.hasOwn(declarations, name) ? declarations[name] : undefined,
        local: name => localTypes.get(name),
        function: name => library.functions?.[name],
    }
    const emitScope: EmitScope = {
        types,
        prop: name => serializePropBindingExpression(name, {propsName: resolvedPropsName, expression: () => ""}),
        local: name => localNames.get(name) ?? sanitizeIdentifier(name),
        literal: value => serializeValueExpression(value, imports, metadata),
        function: name => {
            const identity = functionIdentities.get(name)
            const entry = identity && imports.get(identityKey(identity))
            if (!entry) throw new Error(`exportToTsx: internal error - missing import for function ${JSON.stringify(name)}`)
            return entry.localName
        },
    }
    const localLines: string[] = []
    for (const [name, constName] of localNames) {
        const expression = (locals[name] as CompositionLocal).expression
        localLines.push(`    const ${constName} = ${emitExpression(expression, emitScope)}`)
        localTypes.set(name, expressionSchema(expression, types))
    }
    const ctx: EmitContext = {propsName: resolvedPropsName, expression: expression => emitExpression(expression, emitScope)}
    const bodyJsx = renderInstanceJsx(doc.root, metadata, imports, ctx)

    const lines = [
        "// Generated by @reactive-forge/runtime's exportToTsx. Do not edit.",
        ...importLines,
        "",
        `export default function ${exportedComponentName}(${propTypes.length ? `${propsParamName}: { ${propTypes.join("; ")} }${Object.values(declarations).every(prop => !prop.required || prop.defaultValue !== undefined) ? " = {}" : ""}` : ""}) {`,
        ...(defaultAssignments.length ? [`    const ${resolvedPropsName} = {...${propsParamName}, ${defaultAssignments.join(", ")}}`] : []),
        ...localLines,
        `    return (`,
        `        ${bodyJsx}`,
        `    )`,
        `}`,
        ""
    ]
    return lines.join("\n")
}

// ---------------------------------------------------------------------------------------------
// Import table - unified over project components (looked up in `metadata`) and external
// components (identified entirely by `ExternalComponentIdentity`, no metadata entry required).
// ---------------------------------------------------------------------------------------------

type ImportKey = string

function projectKey(id: string): ImportKey {
    return `project:${id}`
}

function externalKey(identity: ExternalComponentIdentity): ImportKey {
    return `external:${identity.package}:${identity.subpath ?? ""}:${identity.exportName}:${String(identity.isDefault)}`
}

function identityKey(identity: ComponentIdentity): ImportKey {
    return identity.source === "project" ? projectKey(identity.id) : externalKey(identity)
}

interface ImportEntry {
    identity: ComponentIdentity
    meta?: ComponentMetadata   // present iff identity.source === "project"
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

function collectSlotItemComponentIds(item: CompositionSlotItem, ids: Map<ImportKey, ComponentIdentity>, metadata: MetadataDocument): void {
    if (item.kind === "instance") collectInstanceComponentIds(item.instance, ids, metadata)
}

// Walks a CompositionValue for nested component references needing an import - the v3
// generalization of the old (now-deleted) ValueJson-walking `collectValueComponentIds`. A "leaf"
// contributes nothing (a validated v3 leaf can never contain "element" - section 1.4).
function collectCompositionValueComponentIds(value: CompositionValue, ids: Map<ImportKey, ComponentIdentity>, metadata: MetadataDocument): void {
    switch (value.kind) {
        case "prop":
        case "leaf":
            return
        case "componentRef":
            ids.set(identityKey(value.value), value.value)
            return
        case "nodes":
            for (const item of value.value.items) collectSlotItemComponentIds(item, ids, metadata)
            return
        case "object":
            for (const child of Object.values(value.fields)) collectCompositionValueComponentIds(child, ids, metadata)
            return
        case "array":
            for (const item of value.items) collectCompositionValueComponentIds(item.value, ids, metadata)
            return
        case "variant":
            collectCompositionValueComponentIds(value.value, ids, metadata)
            return
        case "expression":
            return
    }
}

// Real bug fixed (phase 4 demo work surfaced it): this previously always registered a "nodes"-slot
// instance under `projectKey(node.componentId)`/`{source:"project", id}`, even when that
// `componentId`'s own `ComponentMetadata.external` was set. `componentRef` references already
// looked this up correctly (`entry.identity`); a plain nested instance did not.
function instanceImportKeyAndIdentity(componentId: string, metadata: MetadataDocument): { key: ImportKey, identity: ComponentIdentity } {
    const meta = findComponentMeta(metadata, componentId)
    return meta.external !== undefined
        ? {key: identityKey(meta.external), identity: meta.external}
        : {key: projectKey(componentId), identity: {source: "project", id: componentId}}
}

function collectInstanceComponentIds(node: CompositionInstance, ids: Map<ImportKey, ComponentIdentity>, metadata: MetadataDocument): void {
    const {key, identity} = instanceImportKeyAndIdentity(node.componentId, metadata)
    ids.set(key, identity)
    for (const propValue of Object.values(node.props)) {
        if (propValue.kind === "callback") throw new Error(`exportToTsx: legacy callback ${JSON.stringify(propValue.name)} cannot be exported; explicitly declare the component prop in a schemaVersion 5 document and bind it with kind: "prop"`)
        if (propValue.kind === "prop") continue
        collectCompositionValueComponentIds(propValue.value, ids, metadata)
    }
}

function sanitizeIdentifier(name: string): string {
    let result = name.replace(/[^A-Za-z0-9_$]/g, "_")
    if (result === "" || !/^[A-Za-z_$]/.test(result)) result = `_${result}`
    return result
}

function baseLocalNameFor(identity: ComponentIdentity, metadata: MetadataDocument): string {
    if (identity.source === "project") return findComponentMeta(metadata, identity.id).name
    if (identity.exportName !== "default") return identity.exportName
    const segments = identity.package.split("/")
    const lastSegment = segments[segments.length - 1]
    return lastSegment !== undefined && lastSegment !== "" ? lastSegment : identity.package
}

function buildImportTable(ids: Map<ImportKey, ComponentIdentity>, metadata: MetadataDocument, usedNames = new Set<string>()): Map<ImportKey, ImportEntry> {
    const table = new Map<ImportKey, ImportEntry>()
    for (const key of [...ids.keys()].sort()) {
        const identity = ids.get(key)
        if (identity === undefined) continue
        const meta = identity.source === "project" ? findComponentMeta(metadata, identity.id) : undefined
        const localName = uniqueIdentifier(sanitizeIdentifier(baseLocalNameFor(identity, metadata)), usedNames)
        table.set(key, {identity, meta, localName})
    }
    return table
}

const validIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const reservedBindings = new Set("await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof interface implements let new null package private protected public return static super switch this throw true try typeof var void while with yield eval arguments".split(" "))

function isBindingIdentifier(name: string): boolean {
    return validIdentifierPattern.test(name) && !reservedBindings.has(name)
}

function uniqueIdentifier(base: string, used: Set<string>): string {
    const safe = isBindingIdentifier(base) ? base : `_${base}`
    let result = safe
    for (let n = 1; used.has(result); n++) result = `${safe}${String(n)}`
    used.add(result)
    return result
}

function formatImportLine(params: { isDefault: boolean, exportedName: string, localName: string, specifier: string }): string {
    const specifierText = JSON.stringify(params.specifier)
    if (params.isDefault) return `import ${params.localName} from ${specifierText}`
    const importedName = validIdentifierPattern.test(params.exportedName) ? params.exportedName : JSON.stringify(params.exportedName)
    const binding = params.exportedName === params.localName ? params.localName : `${importedName} as ${params.localName}`
    return `import { ${binding} } from ${specifierText}`
}

function formatImportStatement(entry: ImportEntry, resolveImportPath: (component: ComponentMetadata) => string): string {
    if (entry.identity.source === "project") {
        const meta = entry.meta
        if (meta === undefined) throw new Error(`exportToTsx: internal error - missing metadata for project import entry "${entry.localName}"`)
        return formatImportLine({isDefault: meta.isDefault, exportedName: meta.name, localName: entry.localName, specifier: resolveImportPath(meta)})
    }
    const identity = entry.identity
    return formatImportLine({
        isDefault: identity.isDefault,
        exportedName: identity.exportName,
        localName: entry.localName,
        specifier: identity.package + (identity.subpath ?? "")
    })
}

// ---------------------------------------------------------------------------------------------
// Value/prop serialization.
// ---------------------------------------------------------------------------------------------

function serializeNumberLiteral(value: number): string {
    if (Number.isNaN(value)) return "NaN"
    if (value === Infinity) return "Infinity"
    if (value === -Infinity) return "-Infinity"
    return JSON.stringify(value)
}

function serializeObjectExpression(value: Record<string, ValueJson>, imports: Map<ImportKey, ImportEntry>, metadata: MetadataDocument): string {
    const entries = Object.entries(value).map(([key, item]) => {
        const keyText = validIdentifierPattern.test(key) ? key : JSON.stringify(key)
        return `${keyText}: ${serializeValueExpression(item, imports, metadata)}`
    })
    return `{${entries.join(", ")}}`
}

// A "leaf" ValueJson containing an "element" node is refused upstream by validateComposition
// (docs/slot-contract-recursive.md section 1.4) - unreachable from any v3-validated document, but
// kept (not removed) since ValueJson's own type still carries the "element" variant for
// PropMetadata.defaultValue/exampleValue elsewhere, and serializeValueExpression's switch must stay
// exhaustive over the whole ValueJson union.
function serializeElementExpression(element: {path: string, name: string, args: Record<string, ValueJson>}, imports: Map<ImportKey, ImportEntry>, metadata: MetadataDocument): string {
    const meta = findComponentMetaByIdentity(metadata, element.path, element.name)
    const entry = imports.get(projectKey(meta.id))
    if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for component id "${meta.id}"`)
    const attributes = Object.entries(element.args)
        .map(([name, argValue]) => `${validIdentifierPattern.test(name) ? name : JSON.stringify(name)}={${serializeValueExpression(argValue, imports, metadata)}}`)
        .join(" ")
    return `<${entry.localName}${attributes ? ` ${attributes}` : ""} />`
}

function serializeValueExpression(value: ValueJson, imports: Map<ImportKey, ImportEntry>, metadata: MetadataDocument): string {
    switch (value.type) {
        case "instance": {
            const entry = imports.get(`adapter:${value.adapterId}`)
            if (!entry) throw new Error(`Missing export factory for ${value.adapterId}`)
            return `${entry.localName}(${serializeValueExpression(value.value, imports, metadata)})`
        }
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

function serializePropBindingExpression(name: string, ctx: EmitContext): string {
    return `${ctx.propsName}[${JSON.stringify(name)}]`
}

// ---------------------------------------------------------------------------------------------
// "nodes" slot serialization - mirrors render.ts's renderNodesValue/renderSlotItem exactly,
// including its precise Fragment-wrapping condition, now resolved at any SlotPath depth
// (docs/slot-contract-recursive.md section 5).
// ---------------------------------------------------------------------------------------------

function serializeSlotItemAsExpression(item: CompositionSlotItem, metadata: MetadataDocument, imports: Map<ImportKey, ImportEntry>, ctx: EmitContext): string {
    switch (item.kind) {
        case "text":
            return JSON.stringify(item.value)
        case "void":
            return "null"
        case "instance":
            return renderInstanceJsx(item.instance, metadata, imports, ctx)
    }
}

function serializeSlotItemAsChild(item: CompositionSlotItem, metadata: MetadataDocument, imports: Map<ImportKey, ImportEntry>, ctx: EmitContext): string {
    switch (item.kind) {
        case "text":
            return `{${JSON.stringify(item.value)}}`
        case "void":
            return "{null}"
        case "instance":
            return renderInstanceJsx(item.instance, metadata, imports, ctx)
    }
}

function serializeSlotValueExpression(
    rule: ReturnType<typeof resolveSlotPolicy>,
    items: CompositionSlotItem[],
    metadata: MetadataDocument,
    imports: Map<ImportKey, ImportEntry>,
    ctx: EmitContext
): string {
    const multiple = rule?.slot !== undefined && "multiple" in rule.slot && rule.slot.multiple === true

    if (items.length === 1 && !multiple) {
        const only = items[0]
        if (only === undefined) return "null"
        return serializeSlotItemAsExpression(only, metadata, imports, ctx)
    }

    const childrenSrc = items.map(item => serializeSlotItemAsChild(item, metadata, imports, ctx)).join("")
    return `<>${childrenSrc}</>`
}

// ---------------------------------------------------------------------------------------------
// Recursive CompositionValue serialization, docs/slot-contract-recursive.md section 5's table -
// the SAME dispatch shape as render.ts's renderCompositionValue, producing source text instead of
// a live JS value.
// ---------------------------------------------------------------------------------------------

function serializeCompositionValue(
    componentMeta: ComponentMetadata,
    path: SlotPath,
    value: CompositionValue,
    metadata: MetadataDocument,
    imports: Map<ImportKey, ImportEntry>,
    ctx: EmitContext
): string {
    switch (value.kind) {
        case "prop":
            return serializePropBindingExpression(value.name, ctx)
        case "leaf":
            return serializeValueExpression(value.value, imports, metadata)
        case "componentRef": {
            const entry = imports.get(identityKey(value.value))
            if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for a componentRef value`)
            return entry.localName
        }
        case "nodes": {
            const rule = resolveSlotPolicy(componentMeta, path)
            return serializeSlotValueExpression(rule, value.value.items, metadata, imports, ctx)
        }
        case "object": {
            const entries = Object.entries(value.fields).map(([key, childValue]) => {
                const keyText = validIdentifierPattern.test(key) ? key : JSON.stringify(key)
                return `${keyText}: ${serializeCompositionValue(componentMeta, [...path, key], childValue, metadata, imports, ctx)}`
            })
            return `{${entries.join(", ")}}`
        }
        case "array": {
            const elements = value.items.map(item =>
                serializeCompositionValue(componentMeta, [...path, {kind: "each"}], item.value, metadata, imports, ctx))
            return `[${elements.join(", ")}]`
        }
        case "variant":
            return serializeCompositionValue(componentMeta, [...path, {kind: "variant", prop: value.selector.prop, equals: value.selector.equals}], value.value, metadata, imports, ctx)
        case "expression":
            return ctx.expression(value.expression)
    }
}

// ---------------------------------------------------------------------------------------------
// Prop-fragment / instance serialization.
// ---------------------------------------------------------------------------------------------

const jsxAttributeNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/

function serializePropFragment(
    propName: string,
    propValue: CompositionPropValue,
    componentMeta: ComponentMetadata,
    imports: Map<ImportKey, ImportEntry>,
    metadata: MetadataDocument,
    ctx: EmitContext
): string {
    const exprText = propValue.kind === "callback" || propValue.kind === "prop"
        ? serializePropBindingExpression(propValue.name, ctx)
        : serializeCompositionValue(componentMeta, [propName], propValue.value, metadata, imports, ctx)

    if (!jsxAttributeNamePattern.test(propName))
        return `{...{ ${JSON.stringify(propName)}: ${exprText} }}`

    // A bare JSX string-literal attribute (`name="text"`) only for a plain string "leaf" value
    // containing none of the characters that would need escaping inside a JSX string-literal
    // attribute - everything else uses an expression container.
    if (propValue.kind === "composed" && propValue.value.kind === "leaf" && propValue.value.value.type === "string" && /^[^"<>{}\r\n\\]*$/.test(propValue.value.value.value))
        return `${propName}="${propValue.value.value.value}"`

    return `${propName}={${exprText}}`
}

// Components without an explicit children prop remain self-closing. Other node slots
// remain attributes even when they contain JSX.
function renderInstanceJsx(node: CompositionInstance, metadata: MetadataDocument, imports: Map<ImportKey, ImportEntry>, ctx: EmitContext): string {
    const meta = findComponentMeta(metadata, node.componentId)
    const {key} = instanceImportKeyAndIdentity(node.componentId, metadata)
    const entry = imports.get(key)
    if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for component id "${meta.id}"`)

    const propFragments = Object.entries(node.props)
        .filter(([name]) => name !== "children")
        .map(([name, value]) => serializePropFragment(name, value, meta, imports, metadata, ctx))
    const opening = `<${entry.localName}${propFragments.length > 0 ? ` ${propFragments.join(" ")}` : ""}`
    const children = node.props["children"]
    if (children === undefined) return `${opening} />`
    if (children.kind === "composed" && children.value.kind === "nodes") {
        const content = children.value.value.items
            .map(item => serializeSlotItemAsChild(item, metadata, imports, ctx))
            .join("")
        return `${opening}>${content}</${entry.localName}>`
    }
    const expression = children.kind === "callback" || children.kind === "prop"
        ? serializePropBindingExpression(children.name, ctx)
        : serializeCompositionValue(meta, ["children"], children.value, metadata, imports, ctx)
    const content = expression.startsWith("<") ? expression : `{${expression}}`
    return `${opening}>${content}</${entry.localName}>`
}
import {findValueAdapter, visitInstanceValues} from "./adapters.js"
