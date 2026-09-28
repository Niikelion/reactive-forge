import type {
    ComponentIdentity,
    ComponentMetadata,
    ExternalComponentIdentity,
    MetadataDocument,
    RichTextBlockNode,
    RichTextTextNode,
    RichTextValueJson,
    ValueJson
} from "@reactive-forge/schema"
import {CompositionDocument, CompositionInstance, CompositionPropValue, CompositionSlotItem} from "./composition.js"
import {resolvePropSlotRules} from "./validate.js"

// Composition-to-TSX export (gate E, extended for slots — docs/slot-contract.md section 9).
// Pure source-text generation - no compiler dependency (no ts-morph/typescript/esbuild),
// deliberately, so this can live in @reactive-forge/runtime without breaking its "browser runtime
// independent of compiler tooling" contract (docs/baseline.md, "Runtime (gate D, part 1)").
//
// v2: accepts the v2 CompositionDocument shape only (composition.ts's plain, unsuffixed names -
// see that file's versioning doc comment). A schemaVersion: 1 document is refused with a plain
// Error naming migrateCompositionDocumentV1ToV2 as the required step, matching validate.ts's
// "unsupported-schema-version" rejection (exportToTsx has no CompositionDiagnostic machinery of
// its own, so this stays a thrown Error, as the v1 exporter already did for its own version gate).
//
// "nodes"/"richText"/"componentRef" prop values are serialized to mirror render.ts's real,
// current v2 rendering EXACTLY, in source-text form (docs/slot-contract.md section 9's explicit
// "mirroring rendering exactly in source-text form" requirement):
//  - "nodes": each CompositionSlotItem in order ("instance" -> nested JSX element, "text" ->
//    a string literal expression, "void" -> `null`), wrapped in a Fragment (`<>...</>`) when
//    there is more than one item OR the resolved policy has `multiple === true` **literally set as
//    an own key** on the resolved EffectiveSlotRule.slot - the exact `"multiple" in slot` check
//    render.ts's renderSlotValue already implements (not the type-level "default true" prose in
//    docs/slot-contract.md section 3's AnyNodePolicy comment); a single-item non-multiple slot
//    stays bare, exactly matching render.ts's `rendered.length === 1 && !multiple` branch.
//  - "richText": the same fixed <strong>/<em>/<p>/<ul>/<ol>/<li> mapping render.ts's
//    renderRichText*Node functions produce, as literal JSX source text, wrapped in `<>...</>`.
//  - "componentRef": a bare identifier expression (`prop={Button}`), never JSX-wrapped, never
//    called - with an import added for the referenced ComponentIdentity (project or external).
//
// `children` is NOT a special case here (docs/slot-contract.md section 9's explicit "no longer a
// special case in your exporter's own logic"): it is just another `"nodes"`-kind prop, serialized
// as a JSX attribute (`children={...}`) exactly like any other prop - never nested JSX children
// syntax. `<Tag children={expr} />` and `<Tag>{expr}</Tag>` produce the identical React element, so
// this loses nothing while collapsing what used to be two code paths (renderChildJsx/
// renderInstanceJsx's separate children-nesting logic) into the single serializePropFragment path
// every other prop already uses.

export interface ExportOptions {
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
 * Renders a v2 `CompositionDocument` back into TSX source text: import statements for every
 * distinct component the tree references - as a nested instance, a `"value"` prop's embedded
 * `"element"` reference, or a `"componentRef"` prop value (project or external identity) - and a
 * single exported component whose JSX body mirrors the composition tree exactly.
 *
 * Does not validate `doc` against a `ComponentLibraryData` (this is a static export - no loaded
 * components are required). It does resolve every referenced component id/identity against
 * `metadata`, and throws a plain `Error` if a project id has no corresponding `ComponentMetadata`
 * entry, since the exporter cannot produce a valid import for a component it cannot identify.
 * Callers wanting full structural validation (missing required props, wrong-typed values,
 * unresolved callbacks, slot-policy violations) should run `validateComposition` from
 * `./validate.js` first - the same function `renderComposition` uses.
 */
export function exportToTsx(doc: CompositionDocument, metadata: MetadataDocument, options: ExportOptions = {}): string {
    const schemaVersion: number = doc.schemaVersion
    if (schemaVersion === 1)
        throw new Error(`exportToTsx: composition schemaVersion 1 is not accepted by the v2 exporter; call migrateCompositionDocumentV1ToV2(doc) first`)
    if (schemaVersion !== 2)
        throw new Error(`exportToTsx: unsupported composition schemaVersion: ${String(schemaVersion)}`)

    const exportedComponentName = options.exportedComponentName ?? "ExportedComposition"
    const callbacksParamName = options.callbacksParamName ?? "callbacks"
    const resolveImportPath = options.resolveImportPath ?? defaultResolveImportPath

    const referencedIdentities = new Map<ImportKey, ComponentIdentity>()
    collectInstanceComponentIds(doc.root, referencedIdentities, metadata)
    const imports = buildImportTable(referencedIdentities, metadata)

    const importLines = [...imports.values()]
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

// Walks a single ValueJson value for nested "element" references (a single nested-component
// reference embedded in an ordinary prop, distinct from a "nodes"-kind slot) - always a project
// component, per the unchanged v1 ValueJson "element" variant shape.
function collectValueComponentIds(value: ValueJson, ids: Map<ImportKey, ComponentIdentity>, metadata: MetadataDocument): void {
    switch (value.type) {
        case "array":
            for (const item of value.value) collectValueComponentIds(item, ids, metadata)
            return
        case "object":
            for (const item of Object.values(value.value)) collectValueComponentIds(item, ids, metadata)
            return
        case "element": {
            const meta = findComponentMetaByIdentity(metadata, value.value.path, value.value.name)
            ids.set(projectKey(meta.id), {source: "project", id: meta.id})
            for (const arg of Object.values(value.value.args)) collectValueComponentIds(arg, ids, metadata)
            return
        }
        default:
            return
    }
}

function collectSlotItemComponentIds(item: CompositionSlotItem, ids: Map<ImportKey, ComponentIdentity>, metadata: MetadataDocument): void {
    if (item.kind === "instance") collectInstanceComponentIds(item.instance, ids, metadata)
}

function collectInstanceComponentIds(node: CompositionInstance, ids: Map<ImportKey, ComponentIdentity>, metadata: MetadataDocument): void {
    ids.set(projectKey(node.componentId), {source: "project", id: node.componentId})
    for (const propValue of Object.values(node.props)) {
        switch (propValue.kind) {
            case "value":
                collectValueComponentIds(propValue.value, ids, metadata)
                break
            case "componentRef":
                ids.set(identityKey(propValue.value), propValue.value)
                break
            case "nodes":
                for (const item of propValue.value.items) collectSlotItemComponentIds(item, ids, metadata)
                break
            case "callback":
            case "richText":
                break
        }
    }
}

function sanitizeIdentifier(name: string): string {
    let result = name.replace(/[^A-Za-z0-9_$]/g, "_")
    if (result === "" || !/^[A-Za-z_$]/.test(result)) result = `_${result}`
    return result
}

// The base local identifier a fresh import binds to, before collision disambiguation: a project
// component's public name, or - for an external identity - its exportName (falling back to the
// package's last path segment for a `"default"` export, since "default" itself is a useless local
// name).
function baseLocalNameFor(identity: ComponentIdentity, metadata: MetadataDocument): string {
    if (identity.source === "project") return findComponentMeta(metadata, identity.id).name
    if (identity.exportName !== "default") return identity.exportName
    const segments = identity.package.split("/")
    const lastSegment = segments[segments.length - 1]
    return lastSegment !== undefined && lastSegment !== "" ? lastSegment : identity.package
}

// A deterministic, human-readable disambiguator for a collision - the project component's own
// stable metadata id, or (for an external identity, which has no id of its own) its
// package+exportName, sanitized the same way a local name is.
function disambiguatorFor(identity: ComponentIdentity): string {
    return identity.source === "project" ? identity.id : `${identity.package}_${identity.exportName}`
}

// Builds the import-key -> {identity, meta?, localName} table, deterministically (sorted by key)
// and collision-free: two distinct components (project or external) that would otherwise sanitize
// to the same local identifier get their own disambiguator appended.
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

// A single import-line formatter shared by both project and external components - the same
// default-vs-named-import logic the v1 exporter already implemented for project components,
// generalized to also build an external component's import statement from
// `ExternalComponentIdentity.package`/`subpath`/`exportName`/`isDefault` (docs/slot-contract.md
// section 9), rather than a separate parallel implementation.
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

function serializeElementExpression(element: {path: string, name: string, args: Record<string, ValueJson>}, imports: Map<ImportKey, ImportEntry>, metadata: MetadataDocument): string {
    const meta = findComponentMetaByIdentity(metadata, element.path, element.name)
    const entry = imports.get(projectKey(meta.id))
    if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for component id "${meta.id}"`)
    const attributes = Object.entries(element.args)
        .map(([name, argValue]) => serializePropFragment(name, {kind: "value", value: argValue}, undefined, imports, metadata, ""))
        .join(" ")
    return `<${entry.localName}${attributes ? ` ${attributes}` : ""} />`
}

// Turns a single ValueJson into a bare JS expression's source text (no surrounding `{}`) - used
// both for a JSX attribute's expression container and for array/object element values. Unchanged
// from the v1 exporter.
function serializeValueExpression(value: ValueJson, imports: Map<ImportKey, ImportEntry>, metadata: MetadataDocument): string {
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

// ---------------------------------------------------------------------------------------------
// "nodes" slot serialization - mirrors render.ts's renderSlotValue/renderSlotItem exactly,
// including its precise Fragment-wrapping condition (docs/slot-contract.md section 9).
// ---------------------------------------------------------------------------------------------

// Bare JS-expression form of one CompositionSlotItem - the form used when a single item is the
// entire prop value (embedded directly inside the caller's `prop={...}` expression container, no
// extra wrapping braces).
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

// JSX-child form of one CompositionSlotItem - used when multiple items sit as siblings inside a
// `<>...</>` Fragment, matching how the v1 exporter already emitted a text child as an expression
// container (`{"text"}`), never a bare JSX text node.
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

// Serializes a "nodes" prop value to a bare JS expression (no surrounding `{}` - the caller wraps
// it in the attribute's own expression container). Wraps in `<>...</>` when there is more than one
// item OR the resolved policy's `multiple` key is literally present and `true` - the EXACT same
// condition render.ts's renderSlotValue checks (`"multiple" in rules.itemRule.slot &&
// rules.itemRule.slot.multiple === true`), reusing the same `resolvePropSlotRules` helper so this
// never re-derives or drifts from render.ts's own each()/collection resolution (see validate.ts's
// module doc comment for exactly how a declared-array prop like SlotCard's `actions` resolves its
// per-item rule from `[propName, each()]` vs a bare ReactNode prop's rule at `[propName]`).
function serializeSlotValueExpression(
    propName: string,
    componentMeta: ComponentMetadata,
    items: CompositionSlotItem[],
    metadata: MetadataDocument,
    imports: Map<ImportKey, ImportEntry>,
    callbacksParamName: string
): string {
    const rules = resolvePropSlotRules(componentMeta, propName)
    const multiple = rules.itemRule?.slot !== undefined && "multiple" in rules.itemRule.slot && rules.itemRule.slot.multiple === true

    if (items.length === 1 && !multiple) {
        const only = items[0]
        if (only === undefined) return "null"
        return serializeSlotItemAsExpression(only, metadata, imports, callbacksParamName)
    }

    const childrenSrc = items.map(item => serializeSlotItemAsChild(item, metadata, imports, callbacksParamName)).join("")
    return `<>${childrenSrc}</>`
}

// A "nodes" prop reached through a declared TypeScript array (e.g. SlotCard's `actions:
// ReactNode[]`, resolved via an `each()` path per docs/slot-contract.md section 2) needs a REAL
// array-literal expression, not a Fragment: `renderComposition`'s own JS assignment doesn't care
// whether `props.actions` is a `ReactNode[]` or a single `ReactElement` (JS erases the declared
// type), but the exported TSX is real source text checked against the component's actual
// `ReactNode[]`-typed prop by a real `tsc` run - a Fragment element structurally fails that check
// ("missing length/pop/push/... from ReactNode[]"). This is this exporter's own documented,
// consistent resolution of the same `CompositionSlotItem[]` structural-gap judgment call phase 2
// already flagged in docs/baseline.md ("Composition runtime v2 (slots)"): each stored `items[i]` is
// treated as exactly one array entry's entire content (never more than one node per entry, since
// this document shape has no per-entry sub-list), so every item becomes exactly one array element,
// in order - `actions={[<Greeter />, "Second action"]}` - regardless of the each()-derived policy's
// own `multiple`/cardinality fields (those bound what ONE entry may hold, a concern this shape
// cannot represent beyond one node per entry; they play no role in whether the ARRAY itself is
// Fragment-wrapped, since a declared array is never JSX-wrapped at all). Renders byte-identically
// to the Fragment-based form `renderComposition` would produce for the same items, since a
// `Fragment`'s and a plain array's children flatten to the same sibling output under
// `renderToStaticMarkup`.
function serializeSlotArrayExpression(items: CompositionSlotItem[], metadata: MetadataDocument, imports: Map<ImportKey, ImportEntry>, callbacksParamName: string): string {
    return `[${items.map(item => serializeSlotItemAsExpression(item, metadata, imports, callbacksParamName)).join(", ")}]`
}

// A "nodes" prop is reached through a declared array (see serializeSlotArrayExpression above) iff
// its OWN path (not the each()-derived per-item path) resolves to an ArraySchema - i.e. the raw
// extracted prop type is `SomeReactNodeDomain[]`, not a bare ReactNode. `PropMetadata.schema` is
// the portable, JSON-safe `SchemaJson` (`{type: string, ...}`) codegen already produces; no live
// `Schema` instance/`schemaFromJson` call is needed just to read its top-level `type` tag.
function isDeclaredArrayProp(componentMeta: ComponentMetadata, propName: string): boolean {
    return componentMeta.props[propName]?.schema.type === "array"
}

// ---------------------------------------------------------------------------------------------
// "richText" serialization - the exact same fixed <strong>/<em>/<p>/<ul>/<ol>/<li> mapping
// render.ts's renderRichTextTextNode/renderRichTextBlockNode produce, as literal JSX source text.
// Written directly as source (not via a runtime .map()), so - unlike render.ts, which needs a
// `key` prop because it builds an actual array of React elements at runtime - no `key` attribute
// is needed here: each node is its own distinct JSX expression in the generated source, not an
// array element a React reconciler needs to key.
// ---------------------------------------------------------------------------------------------

function serializeRichTextTextNode(node: RichTextTextNode): string {
    let content = `{${JSON.stringify(node.text)}}`
    // Nested in mark order, mirroring render.ts exactly: the innermost wrap is the LAST mark in
    // node.marks, so marks read left-to-right as "outermost to innermost".
    for (let i = node.marks.length - 1; i >= 0; i--) {
        const mark = node.marks[i]
        if (mark === "bold") content = `<strong>${content}</strong>`
        else if (mark === "italic") content = `<em>${content}</em>`
    }
    return content
}

function serializeRichTextBlockNode(node: RichTextBlockNode): string {
    if (node.type === "paragraph")
        return `<p>${node.children.map(serializeRichTextTextNode).join("")}</p>`
    const tag = node.type === "bulletList" ? "ul" : "ol"
    const items = node.items.map(item => `<li>${item.children.map(serializeRichTextTextNode).join("")}</li>`).join("")
    return `<${tag}>${items}</${tag}>`
}

// Bare JS expression (no surrounding `{}`), always wrapped in a Fragment - render.ts's
// renderRichText returns a plain ReactNode[] (never itself Fragment-wrapped) assigned directly as
// the prop value; a Fragment around the same content renders byte-identically under
// renderToStaticMarkup (a Fragment contributes no markup of its own), so wrapping uniformly here
// keeps the source simple without any risk of a rendering divergence.
function serializeRichTextExpression(value: RichTextValueJson): string {
    const content = value.inline
        ? value.nodes.map(serializeRichTextTextNode).join("")
        : value.nodes.map(serializeRichTextBlockNode).join("")
    return `<>${content}</>`
}

// ---------------------------------------------------------------------------------------------
// Prop-fragment / instance serialization.
// ---------------------------------------------------------------------------------------------

// Plain JSX attribute names are restricted to JSXIdentifier syntax (letters/digits/"-"/"_", no
// arbitrary strings) - unlike an object property name, a prop coming from an unusual quoted
// export/prop name can't always be spelled as `name={...}` directly. Falls back to a spread of a
// single computed key in that rare case, which is always valid regardless of the prop name's shape.
const jsxAttributeNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/

function serializePropFragment(
    propName: string,
    propValue: CompositionPropValue,
    componentMeta: ComponentMetadata | undefined,
    imports: Map<ImportKey, ImportEntry>,
    metadata: MetadataDocument,
    callbacksParamName: string
): string {
    let exprText: string
    switch (propValue.kind) {
        case "callback":
            exprText = serializeCallbackExpression(propValue.name, callbacksParamName)
            break
        case "componentRef": {
            const entry = imports.get(identityKey(propValue.value))
            if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for a componentRef prop "${propName}"`)
            // Bare identifier expression - never JSX-wrapped, never called (docs/slot-contract.md
            // section 9), mirroring render.ts's resolveComponentRef, which passes the raw
            // constructor itself.
            exprText = entry.localName
            break
        }
        case "richText":
            exprText = serializeRichTextExpression(propValue.value)
            break
        case "nodes": {
            if (componentMeta === undefined)
                throw new Error(`exportToTsx: internal error - a "nodes" prop "${propName}" was serialized with no owning component metadata`)
            exprText = isDeclaredArrayProp(componentMeta, propName)
                ? serializeSlotArrayExpression(propValue.value.items, metadata, imports, callbacksParamName)
                : serializeSlotValueExpression(propName, componentMeta, propValue.value.items, metadata, imports, callbacksParamName)
            break
        }
        case "value":
            exprText = serializeValueExpression(propValue.value, imports, metadata)
            break
    }

    if (!jsxAttributeNamePattern.test(propName))
        return `{...{ ${JSON.stringify(propName)}: ${exprText} }}`

    // A bare JSX string-literal attribute (`name="text"`) only for a plain string "value" prop
    // containing none of the characters that would need escaping inside a JSX string-literal
    // attribute - everything else, including every other kind/value shape, uses an expression
    // container.
    if (propValue.kind === "value" && propValue.value.type === "string" && /^[^"<>{}\r\n\\]*$/.test(propValue.value.value))
        return `${propName}="${propValue.value.value}"`

    return `${propName}={${exprText}}`
}

// Renders one CompositionInstance as a JSX expression. Always self-closing: v2 has no special
// "children" nesting case (see the module doc comment above) - every prop, including one literally
// named "children", is emitted as an ordinary attribute via serializePropFragment, so there is
// never a reason to emit nested `<Tag>...</Tag>` child syntax here.
function renderInstanceJsx(node: CompositionInstance, metadata: MetadataDocument, imports: Map<ImportKey, ImportEntry>, callbacksParamName: string): string {
    const meta = findComponentMeta(metadata, node.componentId)
    const entry = imports.get(projectKey(meta.id))
    if (entry === undefined) throw new Error(`exportToTsx: internal error - missing import table entry for component id "${meta.id}"`)

    const propFragments = Object.entries(node.props)
        .map(([name, value]) => serializePropFragment(name, value, meta, imports, metadata, callbacksParamName))
    return `<${entry.localName}${propFragments.length > 0 ? ` ${propFragments.join(" ")}` : ""} />`
}
