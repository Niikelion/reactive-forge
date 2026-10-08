import {
    ArraySchema,
    checkSlotValue,
    ComponentIdentity,
    ComponentLibraryData,
    ComponentMetadata,
    EffectiveSlotRule,
    findComponentEntry,
    isPathResolutionDiagnostic,
    isComponentGroup,
    isComponentGroupRegistered,
    MetadataDocument,
    ObjectSchema,
    registerCommonSchemas,
    resolveSegment,
    resolveSlotPolicy,
    Schema,
    schemaFromJson,
    SlotCheckContext,
    SlotItemCandidate,
    SlotPath,
    stripNullish,
    UnionSchema,
    ValueJson
} from "@reactive-forge/schema"
import {
    CompositionArrayItem,
    CompositionDocument,
    CompositionDocumentV1,
    CompositionDocumentV2,
    CompositionInstance,
    CompositionInstanceV1,
    CompositionInstanceV2,
    CompositionNodeV1,
    CompositionPropValue,
    CompositionPropValueV2,
    CompositionSlotItem,
    CompositionSlotItemV2,
    CompositionExpression,
    CompositionValue,
    declaresProps
} from "./composition.js"
import {assignable, validateDeclarations, validatePropBinding, PropContext} from "./props.js"
import {ExpressionError, expressionSchema, orderLocals, TypeScope} from "./expressions.js"
import type {CallbackRegistry} from "./render.js"

// schemaFromJson (used below to turn a PropMetadata.schema back into a real Schema instance)
// resolves through a process-global factory registry that nothing registers by default - see
// packages/schema/src/schema/commonSchemas.ts. registerCommonSchemas() is idempotent, safe even if
// a host also calls it.
registerCommonSchemas()

/**
 * Diagnostic shape for composition-document validation. Deliberately close to `Diagnostic` in
 * packages/schema/src/schema/metadata.ts (same severity/code/message triad), but `location` (a
 * source-file position) makes no sense for a composition document - `path` (a JSON-pointer-ish
 * string identifying the offending node) replaces it.
 */
export interface CompositionDiagnostic {
    severity: "error" | "warning"
    code: string
    message: string
    path: string
}

export interface ValidationResult {
    valid: boolean
    diagnostics: CompositionDiagnostic[]
}

function findMetadata(metadata: MetadataDocument, id: string): ComponentMetadata | undefined {
    return metadata.components.find(component => component.id === id)
}

// A function-typed prop that is also optional extracts as a union of function/undefined - "is this
// prop callback-shaped" has to look inside a union, not just check the top-level type tag.
function isFunctionLike(schema: {type: string, types?: {type: string}[]}): boolean {
    if (schema.type === "function") return true
    if (schema.type === "union") return (schema.types ?? []).some(isFunctionLike)
    return false
}

// ---------------------------------------------------------------------------------------------
// Shared slot-rule resolution for a single TOP-LEVEL prop path, docs/slot-contract.md section 2's
// each()-through-a-declared-array case and section 7's bare-ReactNode case. Kept for
// `packages/editor` callers (`packages/editor/src/slots.ts` imports this directly, and is not
// itself migrated to the v3 recursive shape by this package - docs/slot-contract-recursive.md's
// assignment scopes that to a later worker). v3's own recursive traversal (`validateCompositionValue`
// below) does NOT use this helper - a nested/array-entry "nodes" position resolves its own rule
// directly via `resolveSlotPolicy(componentMeta, path)` at its own exact path, and the "array"
// CompositionValue case (below) resolves its own `collection` bound the same direct way - so the
// old perEntry/collection-splitting distinction this helper existed for is now simply "what
// resolveSlotPolicy returns at two different paths," handled inline by the recursive walker.
// ---------------------------------------------------------------------------------------------
export interface PropSlotRules {
    /** The rule checked against each stored `CompositionSlotItem`/`ComponentIdentity`. */
    itemRule: ReturnType<typeof resolveSlotPolicy>
    /** The array-length bound on `items.length`, when the prop is a declared array (e.g. `actions`). */
    collection?: { minItems?: number, maxItems?: number }
    /**
     * `true` when `itemRule` came from an `each()` path (a declared-array prop, e.g.
     * `["actions", each()]`) - meaning each stored `items[i]` is its OWN independent entry, each
     * with its own private cardinality budget.
     */
    perEntry: boolean
}

export function resolvePropSlotRules(meta: ComponentMetadata, propName: string): PropSlotRules {
    const eachRule = resolveSlotPolicy(meta, [propName, {kind: "each"}])
    if (eachRule?.slot !== undefined) {
        const topRule = resolveSlotPolicy(meta, [propName])
        return {itemRule: eachRule, collection: topRule?.collection, perEntry: true}
    }
    return {itemRule: resolveSlotPolicy(meta, [propName]), perEntry: false}
}

// Effective minItems for a policy, mirroring docs/slot-contract.md section 3's cardinality
// formulas (the schema package's own equivalent, `resolveCardinality` in SlotCheck.ts, is a
// private, unexported helper - this is a small, deliberate local reimplementation of just the
// `minItems` half, which `checkSlotValue` itself never enforces per-item).
function effectiveMinItems(policy: {kind: string, minItems?: number}): number {
    return policy.minItems ?? 0
}

function toSlotCheckCandidate(item: CompositionSlotItem): SlotItemCandidate {
    return item
}

// ---------------------------------------------------------------------------------------------
// docs/slot-contract-recursive.md section 1.4 / 2.2: a "leaf" CompositionValue's own doc-comment
// claim ("nothing inside this ValueJson is slot-domain") is validated exactly by banning a legacy
// `"element"` node from appearing anywhere inside it, at any depth.
// ---------------------------------------------------------------------------------------------
function containsLegacyElement(value: ValueJson): boolean {
    if (value.type === "instance") return containsLegacyElement(value.value)
    switch (value.type) {
        case "element":
            return true
        case "array":
            return value.value.some(containsLegacyElement)
        case "object":
            return Object.values(value.value).some(containsLegacyElement)
        default:
            return false
    }
}

// ---------------------------------------------------------------------------------------------
// "nodes" value validation, docs/slot-contract-recursive.md section 2.2's second bullet - the
// generalization of v2's `validateSlotValue`'s shared-slot (non-perEntry) branch. Every `"nodes"`
// CompositionValue, wherever it sits in the tree (a top-level prop, an object field, or a
// `"nodes"`-kind array entry), owns its OWN independent `CompositionSlotItem[]` cardinality budget
// - the perEntry/collection split v2 needed is no longer a separate code path here, because an
// array entry's own cardinality is simply this same function called on that entry's own `items`,
// and the ARRAY's own collection bound is checked once, separately, by the `"array"` case below.
// ---------------------------------------------------------------------------------------------
function validateNodesValue(
    rule: EffectiveSlotRule | undefined,
    items: CompositionSlotItem[],
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry | undefined,
    diagnosticPath: string,
    diagnostics: CompositionDiagnostic[],
    propContext: PropContext
): void {
    let nonVoidCount = 0
    items.forEach((item, index) => {
        const itemPath = `${diagnosticPath}.items[${String(index)}]`
        const context: SlotCheckContext = {library, currentItemCount: index, currentNonVoidCount: nonVoidCount, metadata}
        const result = checkSlotValue(rule, toSlotCheckCandidate(item), context)
        if (!result.ok) {
            for (const d of result.diagnostics)
                diagnostics.push({severity: d.severity, code: d.code, message: d.message, path: itemPath})
        }
        if (item.kind !== "void") nonVoidCount++
        if (item.kind === "instance")
            validateInstance(item.instance, `${itemPath}.instance`, metadata, library, callbacks, diagnostics, propContext)
    })

    if (rule?.slot !== undefined) {
        const minItems = effectiveMinItems(rule.slot)
        if (minItems > 0 && nonVoidCount < minItems)
            diagnostics.push({severity: "error", code: "slot-min-items-not-met", message: `Holds ${String(nonVoidCount)} non-void item(s); minItems is ${String(minItems)}`, path: diagnosticPath})
    }
}

/**
 * The recursive traversal, docs/slot-contract-recursive.md section 2.2, verbatim. Dispatches on
 * `value.kind`; `schema` is threaded incrementally (resolved once per level via `resolveSegment`,
 * never re-derived from the root at every node - section 2.1's cost bound).
 */
function validateCompositionValue(
    componentMeta: ComponentMetadata,
    path: SlotPath,
    schema: Schema,
    value: CompositionValue,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry | undefined,
    diagnosticPath: string,
    diagnostics: CompositionDiagnostic[],
    propContext: PropContext,
    targetRequired = false
): void {
    if ((value as {kind: string}).kind === "richText") {
        diagnostics.push({severity: "error", code: "legacy-rich-text-requires-host-conversion", message: "Convert legacy richText to a registered host component", path: diagnosticPath})
        return
    }
    switch (value.kind) {
        case "prop":
            validatePropBinding(value.name, schema, componentMeta, path, diagnosticPath, metadata, library, diagnostics, propContext, targetRequired)
            return
        case "leaf": {
            const rule = resolveSlotPolicy(componentMeta, path)
            if (rule?.slot !== undefined) {
                diagnostics.push({severity: "error", code: "slot-domain-path-not-composed", message: `A "leaf" value cannot sit at a slot-domain path (this path resolves to a "${rule.slot.kind}" policy)`, path: diagnosticPath})
                return
            }
            if (containsLegacyElement(value.value)) {
                diagnostics.push({severity: "error", code: "legacy-element-value-forbidden", message: `A "leaf" value may not contain a legacy "element" node at any depth (docs/slot-contract-recursive.md section 1.4)`, path: diagnosticPath})
                return
            }
            try {
                validateAdapterValue(stripNullish(schema), value.value, library.valueAdapters)
            } catch (error) {
                diagnostics.push({severity: "error", code: "invalid-prop-value", message: error instanceof Error ? error.message : String(error), path: diagnosticPath})
            }
            return
        }
        case "nodes":
        case "componentRef": {
            const rule = resolveSlotPolicy(componentMeta, path)
            if (rule?.slot === undefined) {
                diagnostics.push({severity: "error", code: "unexpected-slot-value", message: `A "${value.kind}" value sits at a path that is not slot-domain`, path: diagnosticPath})
                return
            }
            if (value.kind === "nodes") {
                validateNodesValue(rule, value.value.items, metadata, library, callbacks, diagnosticPath, diagnostics, propContext)
                return
            }
            const candidate: ComponentIdentity = value.value
            const result = checkSlotValue(rule, candidate, {library, currentItemCount: 0, currentNonVoidCount: 0, metadata})
            if (!result.ok)
                for (const d of result.diagnostics) diagnostics.push({severity: d.severity, code: d.code, message: d.message, path: diagnosticPath})
            return
        }
        case "object": {
            const stripped = stripNullish(schema)
            if (!(stripped instanceof ObjectSchema)) {
                diagnostics.push({severity: "error", code: "value-shape-mismatch", message: `Expected an object-shaped value at this path; the resolved schema is "${stripped.name}"`, path: diagnosticPath})
                return
            }
            for (const [key, childValue] of Object.entries(value.fields)) {
                const childSchema = resolveSegment(stripped, key)
                if (isPathResolutionDiagnostic(childSchema)) {
                    diagnostics.push({severity: "error", code: childSchema.code, message: childSchema.message, path: `${diagnosticPath}.${key}`})
                    continue
                }
                validateCompositionValue(componentMeta, [...path, key], childSchema, childValue, metadata, library, callbacks, `${diagnosticPath}.${key}`, diagnostics, propContext, stripped.properties[key]?.required ?? false)
            }
            for (const [key, propSchema] of Object.entries(stripped.properties)) {
                if (key in value.fields) continue
                if (!propSchema.required) continue
                const childPath = [...path, key]
                const rule = resolveSlotPolicy(componentMeta, childPath)
                if (rule?.slot !== undefined) {
                    const minItems = effectiveMinItems(rule.slot)
                    if (minItems > 0)
                        diagnostics.push({severity: "error", code: "slot-min-items-not-met", message: `Field "${key}" is missing but this slot's minItems is ${String(minItems)}`, path: `${diagnosticPath}.${key}`})
                } else {
                    diagnostics.push({severity: "error", code: "missing-required-prop", message: `Required field "${key}" is missing`, path: `${diagnosticPath}.${key}`})
                }
            }
            return
        }
        case "array": {
            const stripped = stripNullish(schema)
            if (!(stripped instanceof ArraySchema)) {
                diagnostics.push({severity: "error", code: "value-shape-mismatch", message: `Expected an array-shaped value at this path; the resolved schema is "${stripped.name}"`, path: diagnosticPath})
                return
            }
            const collection = resolveSlotPolicy(componentMeta, path)?.collection
            if (collection?.maxItems !== undefined && value.items.length > collection.maxItems)
                diagnostics.push({severity: "error", code: "collection-max-items-exceeded", message: `Array holds ${String(value.items.length)} entries; collection maxItems is ${String(collection.maxItems)}`, path: diagnosticPath})
            if (collection?.minItems !== undefined && value.items.length < collection.minItems)
                diagnostics.push({severity: "error", code: "collection-min-items-not-met", message: `Array holds ${String(value.items.length)} entries; collection minItems is ${String(collection.minItems)}`, path: diagnosticPath})

            const elementSchema = resolveSegment(stripped, {kind: "each"})
            if (isPathResolutionDiagnostic(elementSchema)) {
                diagnostics.push({severity: "error", code: elementSchema.code, message: elementSchema.message, path: diagnosticPath})
                return
            }
            value.items.forEach((item, index) => {
                validateCompositionValue(componentMeta, [...path, {kind: "each"}], elementSchema, item.value, metadata, library, callbacks, `${diagnosticPath}.items[${String(index)}]`, diagnostics, propContext)
            })
            return
        }
        case "expression": {
            if (propContext.document.schemaVersion !== 6) {
                diagnostics.push({severity: "error", code: "unsupported-schema-version", message: "Expressions require composition schemaVersion 6", path: diagnosticPath})
                return
            }
            const rule = resolveSlotPolicy(componentMeta, path)
            if (rule?.slot !== undefined) {
                diagnostics.push({severity: "error", code: "slot-domain-path-not-composed", message: `An expression cannot sit at a slot-domain path (this path resolves to a "${rule.slot.kind}" policy)`, path: diagnosticPath})
                return
            }
            validateExpression(value.expression, schema, propContext, diagnosticPath, diagnostics)
            return
        }
        case "variant": {
            const stripped = stripNullish(schema)
            if (!(stripped instanceof UnionSchema)) {
                diagnostics.push({severity: "error", code: "value-shape-mismatch", message: `Expected a union-shaped value at this path; the resolved schema is "${stripped.name}"`, path: diagnosticPath})
                return
            }
            const memberSchema = resolveSegment(stripped, {kind: "variant", prop: value.selector.prop, equals: value.selector.equals})
            if (isPathResolutionDiagnostic(memberSchema)) {
                diagnostics.push({severity: "error", code: memberSchema.code, message: memberSchema.message, path: diagnosticPath})
                return
            }
            validateCompositionValue(componentMeta, [...path, {kind: "variant", prop: value.selector.prop, equals: value.selector.equals}], memberSchema, value.value, metadata, library, callbacks, diagnosticPath, diagnostics, propContext)
            return
        }
    }
}

function typeScope(propContext: PropContext): TypeScope {
    const declarations = declaresProps(propContext.document) ? propContext.document.props : {}
    return {
        prop: name => Object.hasOwn(declarations, name) ? declarations[name] : undefined,
        local: name => propContext.locals?.get(name),
    }
}

/** An expression is well typed and its type fits the position it fills. */
function validateExpression(expression: CompositionExpression, target: Schema, propContext: PropContext, diagnosticPath: string, diagnostics: CompositionDiagnostic[]): void {
    try {
        const produced = expressionSchema(expression, typeScope(propContext))
        if (!assignable(produced, target))
            diagnostics.push({severity: "error", code: "incompatible-expression", message: "The expression's value does not fit this position", path: diagnosticPath})
    } catch (error) {
        diagnostics.push({severity: "error", code: error instanceof ExpressionError ? error.code : "invalid-expression", message: error instanceof Error ? error.message : String(error), path: diagnosticPath})
    }
}

/** Types each local in dependency order. A local that does not type is reported, and left out so its users report it too. */
function validateLocals(propContext: PropContext, diagnostics: CompositionDiagnostic[]): void {
    const document = propContext.document
    propContext.locals = new Map()
    if (document.schemaVersion !== 6 || document.locals === undefined) return
    const locals = document.locals
    if (typeof locals !== "object" || locals === null || Array.isArray(locals)) {
        diagnostics.push({severity: "error", code: "invalid-locals", message: "Locals must be a record of named expressions", path: "locals"})
        return
    }
    let order: string[]
    try { order = orderLocals(locals) } catch (error) {
        diagnostics.push({severity: "error", code: error instanceof ExpressionError ? error.code : "invalid-locals", message: error instanceof Error ? error.message : String(error), path: "locals"})
        return
    }
    for (const name of order) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
            diagnostics.push({severity: "error", code: "invalid-local-name", message: `Local "${name}" must be a plain identifier`, path: `locals.${name}`})
            continue
        }
        try { propContext.locals.set(name, expressionSchema((locals[name] as {expression: CompositionExpression}).expression, typeScope(propContext))) }
        catch (error) {
            diagnostics.push({severity: "error", code: error instanceof ExpressionError ? error.code : "invalid-expression", message: error instanceof Error ? error.message : String(error), path: `locals.${name}`})
        }
    }
}

/**
 * v3 entry point, docs/slot-contract-recursive.md section 2.3: for each declared prop,
 * `provided.kind === "callback"` is unchanged (today's callback-name-resolution check);
 * `provided.kind === "composed"` calls `validateCompositionValue` at `[propName]`. Everything
 * above this (is the prop declared at all, is a required prop present, the unknown-prop warning
 * loop) is unchanged from v2.
 */
function validateInstance(
    node: CompositionInstance,
    path: string,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks: CallbackRegistry | undefined,
    diagnostics: CompositionDiagnostic[],
    propContext: PropContext
): void {
    const componentMeta = findMetadata(metadata, node.componentId)
    if (componentMeta === undefined) {
        diagnostics.push({severity: "error", code: "unknown-component-id", message: `No component with id "${node.componentId}" in the metadata document`, path})
        return
    }
    const entry = findComponentEntry(library, node.componentId)
    if (entry === undefined) {
        diagnostics.push({severity: "error", code: "component-not-registered", message: `No registry entry with id "${node.componentId}" for component "${componentMeta.name}" (${componentMeta.sourcePath})`, path})
        return
    }

    // Unknown constraints are configuration errors even for empty or omitted slots.
    for (const rule of componentMeta.slots ?? []) {
        if (rule.slot?.kind !== "components" && rule.slot?.kind !== "componentRef") continue
        for (const group of rule.slot.accepts.filter(isComponentGroup)) {
            if (!isComponentGroupRegistered(library, group))
                diagnostics.push({severity: "error", code: "group-not-registered", message: `Component group "${group.id}" is not registered by this host`, path: `${path}.props.${JSON.stringify(rule.path)}`})
        }
    }

    for (const [propName, propMeta] of Object.entries(componentMeta.props)) {
        const provided = node.props[propName]
        const propPath = `${path}.props.${propName}`

        if (provided === undefined) {
            if (propMeta.required) {
                diagnostics.push({severity: "error", code: "missing-required-prop", message: `Required prop "${propName}" is missing`, path: propPath})
            } else {
                const rule = resolveSlotPolicy(componentMeta, [propName])
                if (rule?.slot !== undefined) {
                    const minItems = effectiveMinItems(rule.slot)
                    if (minItems > 0)
                        diagnostics.push({severity: "error", code: "slot-min-items-not-met", message: `"${propName}" is missing but this slot's minItems is ${String(minItems)}`, path: propPath})
                }
            }
            continue
        }

        if (provided.kind === "prop") {
            validatePropBinding(provided.name, schemaFromJson(propMeta.schema), componentMeta, [propName], propPath, metadata, library, diagnostics, propContext, propMeta.required)
            continue
        }
        if (provided.kind === "callback") {
            if (declaresProps(propContext.document)) {
                diagnostics.push({severity: "error", code: "legacy-callback-binding", message: "Version 5 callbacks must reference an explicitly declared function prop using kind: prop", path: propPath})
                continue
            }
            if (!isFunctionLike(propMeta.schema)) {
                diagnostics.push({severity: "error", code: "callback-for-non-function-prop", message: `Prop "${propName}" is not function-typed and cannot take a callback reference`, path: propPath})
                continue
            }
            if (callbacks !== undefined && !(provided.name in callbacks))
                diagnostics.push({severity: "error", code: "unresolved-callback", message: `Callback reference "${provided.name}" for prop "${propName}" is not present in the host callback registry`, path: propPath})
            continue
        }

        // provided.kind === "composed"
        const schema = schemaFromJson(propMeta.schema)
        validateCompositionValue(componentMeta, [propName], schema, provided.value, metadata, library, callbacks, propPath, diagnostics, propContext, propMeta.required)
    }

    for (const propName of Object.keys(node.props)) {
        if (!(propName in componentMeta.props))
            diagnostics.push({severity: "warning", code: "unknown-prop", message: `Prop "${propName}" is not declared on component "${componentMeta.name}"`, path: `${path}.props.${propName}`})
    }
}

/**
 * Validates a v3 composition document against a `MetadataDocument` (for prop schemas/slot
 * policies/requiredness) and a `ComponentLibraryData` (for actual component registration).
 *
 * `doc.schemaVersion` must be exactly `3` - a `2` or `1` document is refused outright with
 * diagnostic `"unsupported-schema-version"` naming the required migration call(s)
 * (`migrateCompositionDocumentV2ToV3` for `2`, `migrateCompositionDocumentV1ToV2` then
 * `migrateCompositionDocumentV2ToV3` for `1`), per docs/slot-contract-recursive.md section 7.2. This
 * function never branches on `schemaVersion === 1 | 2` to reinterpret the old shapes.
 */
function validateIdentities(root: CompositionInstance, diagnostics: CompositionDiagnostic[]): void {
    const instances = new Set<string>()
    function identity(id: string, seen: Set<string>, path: string): void {
        if (typeof id !== "string" || id.length === 0 || seen.has(id))
            diagnostics.push({severity: "error", code: "invalid-identity", message: "IDs must be nonempty and unique within their identity scope", path})
        seen.add(id)
    }
    function instance(node: CompositionInstance, path: string): void {
        identity(node.instanceId, instances, path)
        for (const [key, prop] of Object.entries(node.props))
            if (prop.kind === "composed") value(prop.value, `${path}.props.${key}`)
    }
    function value(current: CompositionValue, path: string): void {
        if (current.kind === "object") {
            for (const [key, child] of Object.entries(current.fields)) value(child, `${path}.${key}`)
        } else if (current.kind === "variant") value(current.value, path)
        else if (current.kind === "array") {
            const ids = new Set<string>()
            for (const item of current.items) {
                identity(item.itemId, ids, path)
                value(item.value, `${path}.${item.itemId}`)
            }
        } else if (current.kind === "nodes") {
            const ids = new Set<string>()
            for (const item of current.value.items) {
                identity(item.itemId, ids, path)
                if (item.kind === "instance") instance(item.instance, `${path}.${item.itemId}`)
            }
        }
    }
    instance(root, "root")
}

export function validateComposition(
    doc: CompositionDocument | CompositionDocumentV2 | CompositionDocumentV1,
    metadata: MetadataDocument,
    library: ComponentLibraryData,
    callbacks?: CallbackRegistry,
    props?: Record<string, unknown>
): ValidationResult {
    const diagnostics: CompositionDiagnostic[] = []
    const input: unknown = doc
    if (typeof input !== "object" || input === null) {
        diagnostics.push({severity: "error", code: "invalid-composition-shape", message: "Composition document must be an object", path: "root"})
        return {valid: false, diagnostics}
    }
    const schemaVersion: number = doc.schemaVersion
    if (schemaVersion === 1) {
        diagnostics.push({severity: "error", code: "unsupported-schema-version", message: `Composition schemaVersion 1 is not accepted by v3 APIs; call migrateCompositionDocumentV1ToV2(doc) then migrateCompositionDocumentV2ToV3(doc, metadata) first`, path: "root"})
        return {valid: false, diagnostics}
    }
    if (schemaVersion === 2) {
        diagnostics.push({severity: "error", code: "unsupported-schema-version", message: `Composition schemaVersion 2 is not accepted by v3 APIs; call migrateCompositionDocumentV2ToV3(doc, metadata) first`, path: "root"})
        return {valid: false, diagnostics}
    }
    if (schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== 5 && schemaVersion !== 6) {
        diagnostics.push({severity: "error", code: "unsupported-schema-version", message: `Unsupported composition schemaVersion: ${String(schemaVersion)}`, path: "root"})
        return {valid: false, diagnostics}
    }
    if (schemaVersion === 3) visitInstanceValues(doc.root, () => {
        diagnostics.push({severity: "error", code: "unsupported-schema-version", message: "Class values require composition schemaVersion 4", path: "root"})
    })
    const propContext: PropContext = {document: doc as CompositionDocument, supplied: props}
    try {
        validateDeclarations(propContext, metadata, library, diagnostics)
        validateLocals(propContext, diagnostics)
        validateIdentities((doc as CompositionDocument).root, diagnostics)
        validateInstance((doc as CompositionDocument).root, "root", metadata, library, callbacks, diagnostics, propContext)
    } catch (error) {
        diagnostics.push({severity: "error", code: "invalid-composition-shape", message: error instanceof Error ? error.message : String(error), path: "root"})
    }
    return {valid: !diagnostics.some(d => d.severity === "error"), diagnostics}
}

// ---------------------------------------------------------------------------------------------
// Migration, v1 -> v2 (docs/slot-contract.md section 10). Unchanged from phase 2 other than the
// V2-suffixed type names its output/recursion now use (composition.ts's names were repurposed to
// mean v3 - see that file's versioning comment).
// ---------------------------------------------------------------------------------------------

// Small, dependency-free FNV-1a 32-bit hash, hex-encoded - reimplemented locally rather than
// depending on packages/codegen/src/hash.ts's `shortHash` (same algorithm), per the phase-2
// handoff's explicit architecture boundary: packages/runtime must not start depending on
// packages/codegen (compiler tooling stays codegen-only). Not cryptographic; only needs to be
// stable across runs for the small "migrated\0<childIndexPath>" input space this function produces.
function shortHash(input: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
}

function migratedInstanceId(childIndexPath: number[]): string {
    return shortHash(`migrated\0${childIndexPath.join(".")}`)
}

// itemId is a distinct id from the instance's own instanceId (an "instance"-kind slot item wraps
// an instance that already has its own instanceId) - salted with a literal tag so the two never
// collide for the same structural position.
function migratedItemId(childIndexPath: number[]): string {
    return shortHash(`migrated-item\0${childIndexPath.join(".")}`)
}

function migrateNodeToSlotItem(node: CompositionNodeV1, childIndexPath: number[]): CompositionSlotItemV2 {
    const itemId = migratedItemId(childIndexPath)
    if (node.kind === "text") return {itemId, kind: "text", value: node.value}
    if (node.kind === "void") return {itemId, kind: "void"}
    return {itemId, kind: "instance", instance: migrateInstanceV1ToV2(node, childIndexPath)}
}

function migrateInstanceV1ToV2(node: CompositionInstanceV1, childIndexPath: number[]): CompositionInstanceV2 {
    const props: Record<string, CompositionPropValueV2> = {}
    for (const [propName, propValue] of Object.entries(node.props)) {
        // Every existing {kind:"value"}/{kind:"callback"} prop value passes through unchanged -
        // both kinds are still valid CompositionPropValueV2 variants in v2.
        props[propName] = propValue
    }
    if (node.children !== undefined && node.children.length > 0) {
        props["children"] = {
            kind: "nodes",
            value: {items: node.children.map((child, index) => migrateNodeToSlotItem(child, [...childIndexPath, index]))}
        }
    }
    return {
        kind: "instance",
        instanceId: migratedInstanceId(childIndexPath),
        componentId: node.id,
        props
    }
}

/**
 * v1 -> v2 composition document upgrade, docs/slot-contract.md section 10, implemented verbatim
 * (unchanged from phase 2, other than the output type now being explicitly `CompositionDocumentV2`).
 */
export function migrateCompositionDocumentV1ToV2(doc: CompositionDocumentV1): CompositionDocumentV2 {
    return {schemaVersion: 2, root: migrateInstanceV1ToV2(doc.root, [])}
}

// ---------------------------------------------------------------------------------------------
// Migration, v2 -> v3 (docs/slot-contract-recursive.md section 7.3) - metadata-dependent, unlike
// every prior migration in this system's history (see that section's own extensive rationale).
// ---------------------------------------------------------------------------------------------

export interface MigrationDiagnostic {
    severity: "error" | "warning"
    code: string
    message: string
    path: string
}

export interface MigrationResult {
    document: CompositionDocument
    diagnostics: MigrationDiagnostic[]
}

// Fresh, opaque, collision-resistant id generation for content migration synthesizes (a nested
// "element" reference becoming a real instance/slot item has no prior stored id to reuse).
// `crypto.randomUUID` when available (every real browser and Node >= 14.17), a small counter-based
// fallback otherwise - mirrors `packages/editor/src/slots.ts`'s `generateId`, reimplemented locally
// since `packages/runtime` must not depend on `packages/editor` (the dependency runs the other way).
let migrationIdCounter = 0
function freshId(prefix: string): string {
    const cryptoObj = (globalThis as {crypto?: {randomUUID?: () => string}}).crypto
    if (cryptoObj?.randomUUID) return `${prefix}-${cryptoObj.randomUUID()}`
    migrationIdCounter += 1
    return `${prefix}-${Date.now().toString(36)}-${migrationIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function findComponentMetaByIdentity(metadata: MetadataDocument, sourcePath: string, name: string): ComponentMetadata | undefined {
    return metadata.components.find(component => component.sourcePath === sourcePath && component.name === name)
}

// Section 7.3's "walk `value`'s shape in lockstep with `resolvePath`... read-only" pre-check: does
// this ValueJson subtree contain a legacy "element" anywhere, OR does its OWN path, or any reachable
// sub-path through its object/array structure, resolve to a slot-domain policy under CURRENT
// metadata? If neither, the whole subtree is the common "lossless leaf wrap" case (7.3 case 1) and
// needs no further structural decomposition at all.
function valueSubtreeNeedsDecomposition(value: ValueJson, path: SlotPath, componentMeta: ComponentMetadata): boolean {
    if (containsLegacyElement(value)) return true
    if (resolveSlotPolicy(componentMeta, path)?.slot !== undefined) return true
    if (value.type === "object")
        return Object.entries(value.value).some(([key, child]) => valueSubtreeNeedsDecomposition(child, [...path, key], componentMeta))
    if (value.type === "array")
        return value.value.some(child => valueSubtreeNeedsDecomposition(child, [...path, {kind: "each"}], componentMeta))
    return false
}

// Section 7.3 case 2: a plain (non-"element") ValueJson found at a path CURRENT metadata resolves
// as slot-domain. Mechanically lifts where possible; discards (with a MigrationDiagnostic) where
// there is no sensible lift. Returns `null` to mean "omit this position entirely" (only meaningful
// for a componentRef-policy position, which has no "empty" representation of its own).
function liftPlainValueToSlot(
    value: ValueJson,
    path: SlotPath,
    policy: NonNullable<EffectiveSlotRule["slot"]>,
    diagnosticPath: string,
    diagnostics: MigrationDiagnostic[]
): CompositionValue | null {
    if (policy.kind === "components") {
        diagnostics.push({severity: "error", code: "restricted-slot-requires-host-conversion", message: "Convert legacy plain slot content to an explicitly accepted host component", path: diagnosticPath})
        return {kind: "nodes", value: {items: []}}
    }
    if (policy.kind === "any") {
        if (value.type === "string") return {kind: "nodes", value: {items: [{itemId: freshId("item"), kind: "text", value: value.value}]}}
        diagnostics.push({severity: "warning", code: "migrated-value-discarded", message: `Non-string value at a ReactNode-policy path was discarded (original: ${JSON.stringify(value)})`, path: diagnosticPath})
        return {kind: "nodes", value: {items: []}}
    }
    // policy.kind === "componentRef": no sensible mechanical lift from a plain ValueJson at all.
    diagnostics.push({severity: "warning", code: "migrated-value-discarded", message: `A plain value at a componentRef-policy path has no mechanical lift and was discarded (original: ${JSON.stringify(value)})`, path: diagnosticPath})
    return null
}

// Section 7.3 case 3: converts one legacy "element" node's args (Record<string, ValueJson>) into a
// fresh nested instance's own props - "a smaller instance of this exact same conversion," each arg
// treated exactly like an ordinary top-level prop value on the target component.
function migrateElementArgs(
    args: Record<string, ValueJson>,
    targetMeta: ComponentMetadata,
    metadata: MetadataDocument,
    diagnosticPath: string,
    diagnostics: MigrationDiagnostic[]
): Record<string, CompositionPropValue> {
    const props: Record<string, CompositionPropValue> = {}
    for (const [argName, argValue] of Object.entries(args)) {
        const converted = migrateValueJsonAt(argValue, [argName], targetMeta, metadata, `${diagnosticPath}.args.${argName}`, diagnostics)
        if (converted !== null) props[argName] = {kind: "composed", value: converted}
    }
    return props
}

/**
 * The core per-position ValueJson -> CompositionValue conversion, section 7.3's cases 1-3, applied
 * recursively at whatever depth is actually needed (never eagerly decomposing a subtree that
 * `valueSubtreeNeedsDecomposition` proves is entirely slot-free and element-free - section 9's
 * explicit "migration never proactively decomposes" scoping). `path` is the FULL SlotPath from
 * `componentMeta`'s own props root (mirrors `validateCompositionValue`'s `path` parameter exactly).
 * Returns `null` to mean "omit this position" (case 2's componentRef sub-case, or an unresolvable
 * "element" reference - both genuinely have nothing valid to put here).
 */
function migrateValueJsonAt(
    value: ValueJson,
    path: SlotPath,
    componentMeta: ComponentMetadata,
    metadata: MetadataDocument,
    diagnosticPath: string,
    diagnostics: MigrationDiagnostic[]
): CompositionValue | null {
    if (!valueSubtreeNeedsDecomposition(value, path, componentMeta))
        return {kind: "leaf", value}

    if (value.type === "element") {
        const rule = resolveSlotPolicy(componentMeta, path)
        if (rule?.slot === undefined) {
            diagnostics.push({severity: "error", code: "legacy-element-at-non-slot-path", message: `A legacy "element" reference at a path with no current slot policy was discarded (target "${value.value.path}#${value.value.name}")`, path: diagnosticPath})
            return null
        }
        const targetMeta = findComponentMetaByIdentity(metadata, value.value.path, value.value.name)
        if (targetMeta === undefined) {
            diagnostics.push({severity: "error", code: "legacy-element-at-non-slot-path", message: `A legacy "element" reference could not be resolved against current metadata and was discarded (target "${value.value.path}#${value.value.name}")`, path: diagnosticPath})
            return null
        }
        const instance: CompositionInstance = {
            kind: "instance",
            instanceId: freshId("instance"),
            componentId: targetMeta.id,
            props: migrateElementArgs(value.value.args, targetMeta, metadata, diagnosticPath, diagnostics)
        }
        return {kind: "nodes", value: {items: [{itemId: freshId("item"), kind: "instance", instance}]}}
    }

    const rule = resolveSlotPolicy(componentMeta, path)
    if (rule?.slot !== undefined)
        return liftPlainValueToSlot(value, path, rule.slot, diagnosticPath, diagnostics)

    if (value.type === "object") {
        const fields: Record<string, CompositionValue> = {}
        for (const [key, child] of Object.entries(value.value)) {
            const converted = migrateValueJsonAt(child, [...path, key], componentMeta, metadata, `${diagnosticPath}.${key}`, diagnostics)
            if (converted !== null) fields[key] = converted
        }
        return {kind: "object", fields}
    }

    if (value.type === "array") {
        const items: CompositionArrayItem[] = []
        value.value.forEach((child, index) => {
            const converted = migrateValueJsonAt(child, [...path, {kind: "each"}], componentMeta, metadata, `${diagnosticPath}[${String(index)}]`, diagnostics)
            if (converted !== null) items.push({itemId: freshId("item"), value: converted})
        })
        return {kind: "array", items}
    }

    // A primitive with no decomposition need reaching here would already have been caught by the
    // valueSubtreeNeedsDecomposition(...) === false guard above; kept as a safe, total fallback.
    return {kind: "leaf", value}
}

function migrateSlotItemV2ToV3(item: CompositionSlotItemV2, metadata: MetadataDocument, diagnosticPath: string, diagnostics: MigrationDiagnostic[]): CompositionSlotItem {
    if (item.kind !== "instance") return item
    return {itemId: item.itemId, kind: "instance", instance: migrateInstanceV2ToV3(item.instance, metadata, `${diagnosticPath}.items`, diagnostics)}
}

function migratePropValueV2ToV3(
    propName: string,
    propValue: CompositionPropValueV2,
    componentMeta: ComponentMetadata,
    metadata: MetadataDocument,
    diagnosticPath: string,
    diagnostics: MigrationDiagnostic[]
): CompositionPropValue | null {
    switch (propValue.kind) {
        case "callback":
            return propValue
        case "componentRef":
            return {kind: "composed", value: {kind: "componentRef", value: propValue.value}}
        case "richText":
            diagnostics.push({severity: "error", code: "legacy-rich-text-requires-host-conversion", message: "Convert legacy richText content to a registered host component before migration", path: diagnosticPath})
            return null
        case "nodes":
            return {
                kind: "composed",
                value: {
                    kind: "nodes",
                    value: {items: propValue.value.items.map(item => migrateSlotItemV2ToV3(item, metadata, diagnosticPath, diagnostics))}
                }
            }
        case "value": {
            const converted = migrateValueJsonAt(propValue.value, [propName], componentMeta, metadata, diagnosticPath, diagnostics)
            return converted === null ? null : {kind: "composed", value: converted}
        }
    }
}

function migrateInstanceV2ToV3(node: CompositionInstanceV2, metadata: MetadataDocument, diagnosticPath: string, diagnostics: MigrationDiagnostic[]): CompositionInstance {
    const componentMeta = findMetadata(metadata, node.componentId)
    const props: Record<string, CompositionPropValue> = {}
    for (const [propName, propValue] of Object.entries(node.props)) {
        const propPath = `${diagnosticPath}.props.${propName}`
        if (componentMeta === undefined) {
            // Unknown component id under current metadata - nothing to resolve slot policy
            // against; preserve non-"value" kinds structurally (they carry no ValueJson requiring
            // policy-aware decisions) and leaf-wrap a plain "value" as-is, diagnosing the gap.
            diagnostics.push({severity: "warning", code: "migrated-unknown-component", message: `No current metadata for component id "${node.componentId}"; prop "${propName}" migrated structurally without policy awareness`, path: propPath})
            if (propValue.kind === "callback") props[propName] = propValue
            else if (propValue.kind === "componentRef") props[propName] = {kind: "composed", value: {kind: "componentRef", value: propValue.value}}
            else if (propValue.kind === "richText") diagnostics.push({severity: "error", code: "legacy-rich-text-requires-host-conversion", message: "Convert legacy richText to a registered host component", path: propPath})
            else if (propValue.kind === "nodes") props[propName] = {kind: "composed", value: {kind: "nodes", value: {items: propValue.value.items.map(item => migrateSlotItemV2ToV3(item, metadata, propPath, diagnostics))}}}
            else props[propName] = {kind: "composed", value: {kind: "leaf", value: propValue.value}}
            continue
        }
        const converted = migratePropValueV2ToV3(propName, propValue, componentMeta, metadata, propPath, diagnostics)
        if (converted !== null) props[propName] = converted
    }
    return {kind: "instance", instanceId: node.instanceId, componentId: node.componentId, props}
}

/**
 * v2 -> v3 composition document upgrade, docs/slot-contract-recursive.md section 7.3. Total (never
 * throws) - every branch produces a structurally valid v3 value, surfacing anything lossy as a
 * `MigrationDiagnostic` rather than silently discarding it. `metadata` must be the CURRENT
 * (post-repair) `MetadataDocument` - this migration is the first moment existing v2 content is
 * actually checked against policy at all (section 7.3's own rationale for why this is the first
 * migration in the system that needs more than the source document alone as input).
 */
export function migrateCompositionDocumentV2ToV3(doc: CompositionDocumentV2, metadata: MetadataDocument): MigrationResult {
    const diagnostics: MigrationDiagnostic[] = []
    const root = migrateInstanceV2ToV3(doc.root, metadata, "root", diagnostics)
    return {document: {schemaVersion: 3, root}, diagnostics}
}
import {validateAdapterValue, visitInstanceValues} from "./adapters.js"
