import {Fragment, isValidElement} from "react"
import {ArraySchema, checkSlotValue, ComponentLibraryData, ComponentMetadata, ComponentTypeSchema, findComponentEntry, FunctionSchema, isAssignableTo, MetadataDocument, ObjectSchema, ReactNodeSchema, resolveSlotPolicy, Schema, schemaFromJson, SlotPath, UnionSchema, ValueJson} from "@reactive-forge/schema"
import {CompositionDocument, CompositionPropDeclaration, declaresProps} from "./composition.js"
import type {CompositionDiagnostic} from "./validate.js"
import {decodeAdapterValue, encodeAdapterValue, validateAdapterValue} from "./adapters.js"

// Metadata is deliberately less expressive than TypeScript; reject uncertain compatibility.
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
    if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`
    return value === undefined ? "undefined" : JSON.stringify(value)
}
export function assignable(source: Schema, target: Schema): boolean {
    if (canonical(source.toJson()) === canonical(target.toJson())) return true
    if (target.name === "unknown" || source.name === "never") return true
    if (target instanceof ReactNodeSchema) {
        if (["string", "number", "bigint", "boolean", "null", "undefined", "reactNode"].includes(source.name)) return true
        if (source instanceof ArraySchema) return source.tupleTypes.every(member => assignable(member, target)) && (!source.indexType || assignable(source.indexType, target))
    }
    if (source instanceof FunctionSchema && target instanceof FunctionSchema) {
        if (target.returnType.name !== "void" && !assignable(source.returnType, target.returnType)) return false
        // Functions may ignore surplus arguments; required arguments are contravariant.
        if (source.paramsType.tupleTypes.length > target.paramsType.tupleTypes.length) return false
        if (!source.paramsType.tupleTypes.every((parameter, index) => {
            try {return assignable(target.paramsType.typeAtIndex(index), parameter)} catch {return false}
        })) return false
        return !source.paramsType.indexType || !target.paramsType.indexType || assignable(target.paramsType.indexType, source.paramsType.indexType)
    }
    if (source instanceof UnionSchema) return source.types.every(member => assignable(member, target))
    if (target instanceof UnionSchema) return target.types.some(member => assignable(source, member))
    if (source instanceof ObjectSchema && target instanceof ObjectSchema) {
        return Object.entries(target.properties).every(([name, field]) => {
            const provided = source.properties[name]
            return provided ? (!field.required || provided.required) && assignable(provided.schema, field.schema) : !field.required
        }) && Object.entries(source.properties).every(([name, field]) => Object.hasOwn(target.properties, name) || !target.indexType || assignable(field.schema, target.indexType))
    }
    if (source instanceof ArraySchema && target instanceof ArraySchema) {
        if (source.tupleTypes.length < target.tupleTypes.length) return false
        if (source.indexType && (!target.indexType || !assignable(source.indexType, target.indexType))) return false
        return source.tupleTypes.every((member, index) => {try {return assignable(member, target.typeAtIndex(index))} catch {return false}})
    }
    try {return isAssignableTo(source, target)} catch {return false}
}

export interface PropContext {document: CompositionDocument, supplied?: Record<string, unknown>, /** The type of each valid local, for expressions. */ locals?: Map<string, Schema>, /** Functions expressions may call. */ functions?: ComponentLibraryData["functions"]}
function fail(diagnostics: CompositionDiagnostic[], code: string, message: string, path: string): void {
    diagnostics.push({severity: "error", code, message, path})
}
export function resolveCompositionProps(doc: CompositionDocument, supplied: Record<string, unknown>, library: ComponentLibraryData): Record<string, unknown> {
    if (!declaresProps(doc)) return {}
    return Object.fromEntries(Object.entries(doc.props).map(([name, declaration]) => [name,
        Object.hasOwn(supplied, name) && supplied[name] !== undefined ? supplied[name]
            : declaration.defaultValue !== undefined ? decodeAdapterValue(declaration.defaultValue, library.valueAdapters) : undefined]))
}
function acceptsNative(schema: Schema, value: unknown, library: ComponentLibraryData): boolean {
    if (schema instanceof UnionSchema) return schema.types.some(member => acceptsNative(member, value, library))
    if (schema instanceof FunctionSchema) return typeof value === "function"
    if (schema instanceof ReactNodeSchema) {
        if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean" || isValidElement(value)) return true
        return Array.isArray(value) && value.every(item => acceptsNative(schema, item, library))
    }
    if (schema instanceof ComponentTypeSchema) return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value)
    if (schema instanceof ObjectSchema && typeof value === "object" && value !== null && !Array.isArray(value)) {
        const record = value as Record<string, unknown>
        return Object.entries(schema.properties).every(([key, field]) => (!Object.hasOwn(record, key) && !field.required) || acceptsNative(field.schema, record[key], library))
            && Object.entries(record).every(([key, child]) => Object.hasOwn(schema.properties, key) || (schema.indexType !== undefined && acceptsNative(schema.indexType, child, library)))
    }
    if (schema instanceof ArraySchema && Array.isArray(value)) {
        if (value.length < schema.tupleTypes.length) return false
        return value.every((item, index) => {try {return acceptsNative(schema.typeAtIndex(index), item, library)} catch {return false}})
    }
    try { encodeAdapterValue(schema, value, library.valueAdapters); return true } catch { return false }
}
function validateDefault(schema: Schema, value: ValueJson, library: ComponentLibraryData): void {
    if (schema instanceof ReactNodeSchema) {
        if (!acceptsNative(schema, decodeAdapterValue(value, library.valueAdapters), library)) throw new Error("Default is not a supported React node value")
        return
    }
    if (schema instanceof UnionSchema) {
        for (const member of schema.types) {
            try {validateDefault(member, value, library); return} catch { /* Try the next declared alternative. */ }
        }
        throw new Error("Default does not match any declared union member")
    }
    if (schema instanceof ObjectSchema && value.type === "object") {
        for (const [key, field] of Object.entries(schema.properties)) {
            if (!Object.hasOwn(value.value, key) && field.required) throw new Error(`Default is missing required field ${key}`)
        }
        for (const [key, child] of Object.entries(value.value)) {
            const field = Object.hasOwn(schema.properties, key) ? schema.properties[key]?.schema : schema.indexType
            if (!field) throw new Error(`Default has unknown field ${key}`)
            validateDefault(field, child, library)
        }
        return
    }
    if (schema instanceof ArraySchema && value.type === "array") {
        if (value.value.length < schema.tupleTypes.length) throw new Error("Default is missing required tuple entries")
        value.value.forEach((child, index) => {validateDefault(schema.typeAtIndex(index), child, library)})
        return
    }
    validateAdapterValue(schema, value, library.valueAdapters)
}

export function validateDeclarations(context: PropContext, metadata: MetadataDocument, library: ComponentLibraryData, diagnostics: CompositionDiagnostic[]): void {
    if (!declaresProps(context.document)) return
    const declarations = context.document.props as Record<string, CompositionPropDeclaration> | null | undefined
    if (!declarations || typeof declarations !== "object" || Array.isArray(declarations)) {fail(diagnostics, "invalid-prop-declarations", "Version 5 requires an explicit props declaration record", "props"); return}
    for (const [name, rawDeclaration] of Object.entries(declarations)) {
        const declaration = rawDeclaration as CompositionPropDeclaration | null | undefined
        const path = `props.${name}`
        try {
            if (name === "key") throw new Error("Public prop key is reserved for React element identity and is not forwarded; choose another name")
            if (name === "__proto__") throw new Error("Public prop __proto__ cannot be safely forwarded through React props; choose another name")
            if (!name || !declaration || typeof declaration.required !== "boolean") throw new Error("A declaration requires a nonempty name, schema and boolean required")
            if (declaration.description !== undefined && typeof declaration.description !== "string") throw new Error("Description must be a string")
            const schema = schemaFromJson(declaration.schema)
            if (declaration.typeSource) {
                const source = (() => {
                    const component = metadata.components.find(candidate => candidate.id === declaration.typeSource?.componentId)
                    const propName = declaration.typeSource.propName
                    return component && typeof propName === "string" && Object.hasOwn(component.props, propName) ? component.props[propName] : undefined
                })()
                if (!source) throw new Error("typeSource must reference an existing component prop")
                const original = schemaFromJson(source.schema)
                if (canonical(schema.toJson()) !== canonical(original.toJson())) throw new Error("typeSource schema must match the declared schema")
            }
            if (declaration.defaultValue !== undefined) validateDefault(schema, declaration.defaultValue, library)
            if (context.supplied !== undefined) {
                const value = Object.hasOwn(context.supplied, name) && context.supplied[name] !== undefined ? context.supplied[name]
                    : declaration.defaultValue !== undefined ? decodeAdapterValue(declaration.defaultValue, library.valueAdapters) : undefined
                if (value === undefined && declaration.required) fail(diagnostics, "missing-required-composition-prop", `Required composition prop "${name}" was not supplied`, path)
                else if (value !== undefined && !acceptsNative(schema, value, library)) fail(diagnostics, "invalid-composition-prop-value", `Value does not match declaration "${name}"`, path)
            }
        } catch (error) {fail(diagnostics, "invalid-prop-declaration", error instanceof Error ? error.message : String(error), path)}
    }
}
function checkBoundSlots(value: unknown, component: ComponentMetadata, path: SlotPath, library: ComponentLibraryData, metadata: MetadataDocument, diagnostics: CompositionDiagnostic[], diagnosticPath: string): void {
    const rule = resolveSlotPolicy(component, path)
    if (!rule?.slot) return
    const slot = rule.slot
    if (slot.kind === "componentRef") {
        if (value === undefined || value === null) return
        const found = metadata.components.find(candidate => findComponentEntry(library, candidate.id)?.component === value)
        const result = checkSlotValue(rule, found?.external ?? {source: "project", id: found?.id ?? ""}, {library, metadata, currentItemCount: 0, currentNonVoidCount: 0})
        if (!result.ok) for (const diagnostic of result.diagnostics) fail(diagnostics, diagnostic.code, diagnostic.message, diagnosticPath)
        return
    }
    const items: unknown[] = []
    function flatten(node: unknown): void {
        if (Array.isArray(node)) {node.forEach(flatten); return}
        if (isValidElement(node) && node.type === Fragment) {flatten((node.props as {children?: unknown}).children); return}
        if (node !== null && node !== undefined && typeof node !== "boolean") items.push(node)
    }
    flatten(value)
    let nonVoid = 0
    for (const [index, item] of items.entries()) {
        const found = isValidElement(item) ? metadata.components.find(candidate => findComponentEntry(library, candidate.id)?.component === item.type) : undefined
        if (slot.kind === "any") {nonVoid++; continue}
        const candidate = found ? {itemId: String(index), kind: "instance" as const, instance: {componentId: found.id}}
            : typeof item === "string" || typeof item === "number" || typeof item === "bigint" ? {itemId: String(index), kind: "text" as const, value: String(item)} : undefined
        if (!candidate) {fail(diagnostics, "component-not-accepted", "Bound slot element is not registered in the component library", diagnosticPath); continue}
        const result = checkSlotValue(rule, candidate, {library, metadata, currentItemCount: index, currentNonVoidCount: nonVoid})
        if (!result.ok) for (const diagnostic of result.diagnostics) fail(diagnostics, diagnostic.code, diagnostic.message, diagnosticPath)
        nonVoid++
    }
    if (nonVoid < (slot.minItems ?? 0)) fail(diagnostics, "slot-min-items-not-met", "Bound value does not meet slot minimum", diagnosticPath)
    if (slot.kind === "any" && slot.maxItems !== undefined && items.length > slot.maxItems) fail(diagnostics, "slot-max-items-exceeded", "Bound value exceeds slot maximum", diagnosticPath)
}
function validateBoundValue(schema: Schema, value: unknown, component: ComponentMetadata, path: SlotPath, library: ComponentLibraryData, metadata: MetadataDocument, diagnostics: CompositionDiagnostic[], diagnosticPath: string): void {
    checkBoundSlots(value, component, path, library, metadata, diagnostics, diagnosticPath)
    if (schema instanceof ObjectSchema && typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
            const expected = schema.properties[key]?.schema ?? schema.indexType
            if (expected) validateBoundValue(expected, child, component, [...path, key], library, metadata, diagnostics, `${diagnosticPath}.${key}`)
        }
    } else if (schema instanceof ArraySchema && Array.isArray(value)) {
        const collection = resolveSlotPolicy(component, path)?.collection
        if (collection?.minItems !== undefined && value.length < collection.minItems) fail(diagnostics, "collection-min-items-not-met", "Bound array is too short", diagnosticPath)
        if (collection?.maxItems !== undefined && value.length > collection.maxItems) fail(diagnostics, "collection-max-items-exceeded", "Bound array is too long", diagnosticPath)
        value.forEach((child, index) => { validateBoundValue(schema.typeAtIndex(index), child, component, [...path, {kind: "each"}], library, metadata, diagnostics, `${diagnosticPath}[${String(index)}]`) })
    } else if (schema instanceof UnionSchema) {
        const member = schema.types.find(candidate => acceptsNative(candidate, value, library))
        if (member) {
            let memberPath = path
            if (member instanceof ObjectSchema && value !== null && typeof value === "object") {
                const record = value as Record<string, unknown>
                // Resolve the explicit discriminant used by slot annotations before walking fields.
                const declaredVariant = component.slots?.map(rule => rule.path).find(rulePath => {
                    const segment = rulePath[path.length]
                    return canonical(rulePath.slice(0, path.length)) === canonical(path)
                        && typeof segment === "object" && segment.kind === "variant"
                        && record[segment.prop] === segment.equals
                })?.[path.length]
                const literalField = Object.entries(member.properties).find(([key, field]) => {
                    const literal = field.schema.toJson()["literal"]
                    return (typeof literal === "string" || typeof literal === "number" || typeof literal === "boolean") && record[key] === literal
                })
                if (typeof declaredVariant === "object" && declaredVariant.kind === "variant") memberPath = [...path, declaredVariant]
                else if (literalField) {
                    const literal = literalField[1].schema.toJson()["literal"]
                    if (typeof literal === "string" || typeof literal === "number" || typeof literal === "boolean") memberPath = [...path, {kind: "variant", prop: literalField[0], equals: literal}]
                }
            }
            validateBoundValue(member, value, component, memberPath, library, metadata, diagnostics, diagnosticPath)
        }
    }
}
export function validatePropBinding(name: string, target: Schema, component: ComponentMetadata, path: SlotPath, diagnosticPath: string, metadata: MetadataDocument, library: ComponentLibraryData, diagnostics: CompositionDiagnostic[], context: PropContext, targetRequired = false): void {
    if (!declaresProps(context.document)) {fail(diagnostics, "unsupported-schema-version", "Prop bindings require composition schemaVersion 5 or later", diagnosticPath); return}
    const declarations = context.document.props as Record<string, CompositionPropDeclaration> | null | undefined
    const declaration: CompositionPropDeclaration | undefined = declarations && Object.hasOwn(declarations, name) ? declarations[name] : undefined
    if (!declaration) {fail(diagnostics, "undeclared-composition-prop", `Binding references undeclared composition prop "${name}"`, diagnosticPath); return}
    try {
        let source = schemaFromJson(declaration.schema)
        if (declaration.defaultValue !== undefined && declaration.defaultValue.type !== "undefined" && declaration.defaultValue.type !== "void" && source instanceof UnionSchema) {
            const present = source.types.filter(member => member.name !== "undefined" && member.name !== "void")
            if (present.length === 1 && present[0]) source = present[0]
            else if (present.length > 1) source = new UnionSchema(present)
        }
        if (!assignable(source, target)) {fail(diagnostics, "incompatible-prop-binding", `Declared prop "${name}" is incompatible with its target`, diagnosticPath); return}
        if (targetRequired && !declaration.required && (declaration.defaultValue === undefined || declaration.defaultValue.type === "undefined" || declaration.defaultValue.type === "void")) fail(diagnostics, "optional-prop-bound-to-required", `Optional prop "${name}" needs a default when bound to a required target`, diagnosticPath)
        if (context.supplied !== undefined || declaration.defaultValue !== undefined) {
            const value = context.supplied && Object.hasOwn(context.supplied, name) && context.supplied[name] !== undefined ? context.supplied[name]
                : declaration.defaultValue !== undefined ? decodeAdapterValue(declaration.defaultValue, library.valueAdapters) : undefined
            validateBoundValue(target, value, component, path, library, metadata, diagnostics, diagnosticPath)
        }
    } catch (error) {fail(diagnostics, "invalid-prop-binding", error instanceof Error ? error.message : String(error), diagnosticPath)}
}
