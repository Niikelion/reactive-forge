import {
    ComponentIdentity,
    ComponentLibraryData,
    ComponentMetadata,
    ExternalComponentIdentity,
    MetadataDocument,
    resolveSlotPolicy,
    SlotPath,
    ValueJson
} from "@reactive-forge/schema"
import {
    CompositionDocument,
    CompositionInstance,
    CompositionPropValue,
    CompositionSlotItem,
    CompositionValue
} from "./composition.js"
import {validateComposition} from "./validate.js"
import {CompositionValidationError} from "./render.js"

// Composition-to-TSX export (gate E, extended for slots — docs/slot-contract.md section 9, then
// generalized to the recursive v3 value model — docs/slot-contract-recursive.md section 5). Pure
// source-text generation - no compiler dependency (no ts-morph/typescript/esbuild), deliberately, so
// this can live in @reactive-forge/runtime without breaking its "browser runtime independent of
// compiler tooling" contract (docs/baseline.md, "Runtime (gate D, part 1)").
//
// v3: accepts the v3 CompositionDocument shape only (composition.ts's plain, unsuffixed names -
// see that file's versioning doc comment). A schemaVersion 1/2 document is refused with a plain
// Error naming the required migration step(s), matching validate.ts's "unsupported-schema-version"
// rejection (exportToTsx has no CompositionDiagnostic machinery of its own, so this stays a thrown
// Error, as the v1/v2 exporters already did for their own version gates).
//
// serializeCompositionValue mirrors render.ts's renderCompositionValue EXACTLY, in the SAME
// dispatch shape (docs/slot-contract-recursive.md section 5's table), in source-text form:
//  - "leaf": serializeValueExpression - unchanged plain ValueJson serialization.
//  - "object"/"array"/"variant": the NEW recursive cases - an object-literal/array-literal
//    expression per field/entry, or (for "variant") a transparent pass-through. The "array" case
//    directly replaces v2's isDeclaredArrayProp/serializeSlotArrayExpression special case entirely:
//    a declared TypeScript array is now represented by a real "array" CompositionValue node whose
//    entries are independently "nodes"-kind-or-not, so a real array-literal expression with each
//    entry's own independent Fragment-wrapping falls out of the SAME "nodes" dispatch used
//    everywhere else in the tree - this is the literal flat-array-gap closure (contract worked
//    example 8.3).
//  - "nodes": each CompositionSlotItem in order ("instance" -> nested JSX element, "text" -> a
//    string literal expression, "void" -> `null`), wrapped in a Fragment (`<>...</>`) when there is
//    more than one item OR the resolved policy has `multiple === true` literally set as an own key
//    on the resolved EffectiveSlotRule.slot - the exact condition render.ts's renderNodesValue
//    checks, resolved at THIS node's own exact SlotPath via `resolveSlotPolicy` directly (no longer
//    routed through the old top-level-only `resolvePropSlotRules`).
//  - "componentRef": a bare identifier expression (`prop={Button}`), never JSX-wrapped, never
//    called - with an import added for the referenced ComponentIdentity (project or external).
//
// `children` stays an ordinary composition prop, but is emitted between the JSX tags.
// Node-slot children are emitted directly; other slot props retain their Fragment boundaries.
//
// `collectValueComponentIds`'s old v2 "element" case is DELETED ENTIRELY (not merely dead-code-
// unreachable): a v3 "leaf" CompositionValue can never contain a legacy "element" node at all
// (docs/slot-contract-recursive.md section 1.4, enforced by validate.ts's `containsLegacyElement`
// upstream of export), so there is nothing left for a ValueJson-walking import collector to find.
// The import table is now built by walking `CompositionValue` itself (`collectCompositionValueComponentIds`
// below), never by walking a leaf's own `ValueJson`.

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
    /**
     * Name of the prop the exported component accepts for resolving `"callback"`-kind prop values
     * at render time. Default: "callbacks".
     */
    callbacksParamName?: string
}

/**
 * Renders a v3 `CompositionDocument` back into TSX source text: import statements for every
 * distinct component the tree references - as a nested instance or a `"componentRef"` prop value
 * (project or external identity) - and a single exported component whose JSX body mirrors the
 * composition tree exactly.
 *
 * `exportToTsx` requires `library` (needed to run `validateComposition`, the exact function
 * `renderComposition` also runs before rendering) and throws `CompositionValidationError` - the
 * same error type/shape `renderComposition` throws, not a parallel one - before serializing
 * anything, so a document with a forbidden nested component, a disallowed rich-text mark, excess
 * cardinality, or a legacy `"element"` node hidden inside a `"leaf"` value can never produce TSX
 * source text at all. Runs with no `callbacks` registry (export has nothing live to check callback
 * names against - it only ever emits `callbacks.name` symbolically), so an `unresolved-callback`
 * diagnostic is not raised here; every other check (slot policy, required props, value types,
 * component registration, the legacy-`"element"` ban) still runs in full.
 */
export function exportToTsx(doc: CompositionDocument, metadata: MetadataDocument, library: ComponentLibraryData, options: ExportOptions = {}): string {
    if (options.valueAdapters) library = {...library, valueAdapters: {...library.valueAdapters, ...options.valueAdapters}}
    const schemaVersion: number = doc.schemaVersion
    if (schemaVersion === 1)
        throw new Error(`exportToTsx: composition schemaVersion 1 is not accepted by the v3 exporter; call migrateCompositionDocumentV1ToV2(doc) then migrateCompositionDocumentV2ToV3(doc, metadata) first`)
    if (schemaVersion === 2)
        throw new Error(`exportToTsx: composition schemaVersion 2 is not accepted by the v3 exporter; call migrateCompositionDocumentV2ToV3(doc, metadata) first`)
    if (schemaVersion !== 3 && schemaVersion !== 4)
        throw new Error(`exportToTsx: unsupported composition schemaVersion: ${String(schemaVersion)}`)

    const validation = validateComposition(doc, metadata, library)
    if (!validation.valid) throw new CompositionValidationError(validation.diagnostics)

    const exportedComponentName = options.exportedComponentName ?? "ExportedComposition"
    const callbacksParamName = options.callbacksParamName ?? "callbacks"
    const resolveImportPath = options.resolveImportPath ?? defaultResolveImportPath

    const referencedIdentities = new Map<ImportKey, ComponentIdentity>()
    collectInstanceComponentIds(doc.root, referencedIdentities, metadata)
    const imports = buildImportTable(referencedIdentities, metadata)
    const used = new Set([...imports.values()].map(entry => entry.localName))
    used.add(exportedComponentName)
    used.add(callbacksParamName)
    const factories = new Map<string, ImportEntry>()
    visitInstanceValues(doc.root, value => {
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

    const bodyJsx = renderInstanceJsx(doc.root, metadata, imports, callbacksParamName)

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
        if (propValue.kind === "callback") continue
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

function disambiguatorFor(identity: ComponentIdentity): string {
    return identity.source === "project" ? identity.id : `${identity.package}_${identity.exportName}`
}

function buildImportTable(ids: Map<ImportKey, ComponentIdentity>, metadata: MetadataDocument): Map<ImportKey, ImportEntry> {
    const usedNames = new Set<string>()
    const table = new Map<ImportKey, ImportEntry>()
    for (const key of [...ids.keys()].sort()) {
        const identity = ids.get(key)
        if (identity === undefined) continue
        const meta = identity.source === "project" ? findComponentMeta(metadata, identity.id) : undefined
        let localName = sanitizeIdentifier(baseLocalNameFor(identity, metadata))
        if (usedNames.has(localName)) localName = sanitizeIdentifier(`${localName}_${disambiguatorFor(identity)}`)
        usedNames.add(localName)
        table.set(key, {identity, meta, localName})
    }
    return table
}

const validIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

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

function serializeCallbackExpression(name: string, callbacksParamName: string): string {
    return validIdentifierPattern.test(name) ? `${callbacksParamName}.${name}` : `${callbacksParamName}[${JSON.stringify(name)}]`
}

// ---------------------------------------------------------------------------------------------
// "nodes" slot serialization - mirrors render.ts's renderNodesValue/renderSlotItem exactly,
// including its precise Fragment-wrapping condition, now resolved at any SlotPath depth
// (docs/slot-contract-recursive.md section 5).
// ---------------------------------------------------------------------------------------------

function serializeSlotItemAsExpression(item: CompositionSlotItem, metadata: MetadataDocument, imports: Map<ImportKey, ImportEntry>, callbacksParamName: string): string {
    switch (item.kind) {
        case "text":
            return JSON.stringify(item.value)
        case "void":
            return "null"
        case "instance":
            return renderInstanceJsx(item.instance, metadata, imports, callbacksParamName)
    }
}

function serializeSlotItemAsChild(item: CompositionSlotItem, metadata: MetadataDocument, imports: Map<ImportKey, ImportEntry>, callbacksParamName: string): string {
    switch (item.kind) {
        case "text":
            return `{${JSON.stringify(item.value)}}`
        case "void":
            return "{null}"
        case "instance":
            return renderInstanceJsx(item.instance, metadata, imports, callbacksParamName)
    }
}

function serializeSlotValueExpression(
    rule: ReturnType<typeof resolveSlotPolicy>,
    items: CompositionSlotItem[],
    metadata: MetadataDocument,
    imports: Map<ImportKey, ImportEntry>,
    callbacksParamName: string
): string {
    const multiple = rule?.slot !== undefined && "multiple" in rule.slot && rule.slot.multiple === true

    if (items.length === 1 && !multiple) {
        const only = items[0]
        if (only === undefined) return "null"
        return serializeSlotItemAsExpression(only, metadata, imports, callbacksParamName)
    }

    const childrenSrc = items.map(item => serializeSlotItemAsChild(item, metadata, imports, callbacksParamName)).join("")
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
    callbacksParamName: string
): string {
    switch (value.kind) {
        case "leaf":
            return serializeValueExpression(value.value, imports, metadata)
        case "componentRef": {
            const entry = imports.get(identityKey(value.value))
            if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for a componentRef value`)
            return entry.localName
        }
        case "nodes": {
            const rule = resolveSlotPolicy(componentMeta, path)
            return serializeSlotValueExpression(rule, value.value.items, metadata, imports, callbacksParamName)
        }
        case "object": {
            const entries = Object.entries(value.fields).map(([key, childValue]) => {
                const keyText = validIdentifierPattern.test(key) ? key : JSON.stringify(key)
                return `${keyText}: ${serializeCompositionValue(componentMeta, [...path, key], childValue, metadata, imports, callbacksParamName)}`
            })
            return `{${entries.join(", ")}}`
        }
        case "array": {
            const elements = value.items.map(item =>
                serializeCompositionValue(componentMeta, [...path, {kind: "each"}], item.value, metadata, imports, callbacksParamName))
            return `[${elements.join(", ")}]`
        }
        case "variant":
            return serializeCompositionValue(componentMeta, [...path, {kind: "variant", prop: value.selector.prop, equals: value.selector.equals}], value.value, metadata, imports, callbacksParamName)
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
    callbacksParamName: string
): string {
    const exprText = propValue.kind === "callback"
        ? serializeCallbackExpression(propValue.name, callbacksParamName)
        : serializeCompositionValue(componentMeta, [propName], propValue.value, metadata, imports, callbacksParamName)

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
function renderInstanceJsx(node: CompositionInstance, metadata: MetadataDocument, imports: Map<ImportKey, ImportEntry>, callbacksParamName: string): string {
    const meta = findComponentMeta(metadata, node.componentId)
    const {key} = instanceImportKeyAndIdentity(node.componentId, metadata)
    const entry = imports.get(key)
    if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for component id "${meta.id}"`)

    const propFragments = Object.entries(node.props)
        .filter(([name]) => name !== "children")
        .map(([name, value]) => serializePropFragment(name, value, meta, imports, metadata, callbacksParamName))
    const opening = `<${entry.localName}${propFragments.length > 0 ? ` ${propFragments.join(" ")}` : ""}`
    const children = node.props["children"]
    if (children === undefined) return `${opening} />`
    if (children.kind === "composed" && children.value.kind === "nodes") {
        const content = children.value.value.items
            .map(item => serializeSlotItemAsChild(item, metadata, imports, callbacksParamName))
            .join("")
        return `${opening}>${content}</${entry.localName}>`
    }
    const expression = children.kind === "callback"
        ? serializeCallbackExpression(children.name, callbacksParamName)
        : serializeCompositionValue(meta, ["children"], children.value, metadata, imports, callbacksParamName)
    const content = expression.startsWith("<") ? expression : `{${expression}}`
    return `${opening}>${content}</${entry.localName}>`
}
import {findValueAdapter, visitInstanceValues} from "./adapters.js"
