import {SchemaJson, schemaFromJson, InstanceSchema, ArraySchema, ObjectSchema, FunctionSchema, UnionSchema, ComponentTypeSchema, StringSchema, NumberSchema, BooleanSchema, BigIntSchema} from "@reactive-forge/schema"

/** Serializes the declared schema, never infers a public prop from its consumers. */
export function exportSchemaType(json: SchemaJson, resolveProjectPath: (path: string) => string): string {
    const schema = schemaFromJson(json)
    const child = (value: {toJson(): SchemaJson}): string => exportSchemaType(value.toJson(), resolveProjectPath)
    if (schema instanceof StringSchema || schema instanceof NumberSchema || schema instanceof BooleanSchema)
        return schema.literal === undefined ? schema.name : JSON.stringify(schema.literal)
    if (schema instanceof BigIntSchema) return schema.literal === undefined ? "bigint" : `${String(schema.literal)}n`
    if (schema instanceof ArraySchema) {
        if (schema.tupleTypes.length === 0 && schema.indexType) return `Array<${child(schema.indexType)}>`
        return `[${[...schema.tupleTypes.map(child), ...(schema.indexType ? [`...Array<${child(schema.indexType)}>`] : [])].join(", ")}]`
    }
    if (schema instanceof ObjectSchema) {
        const properties = Object.entries(schema.properties).map(([name, prop]) => `${JSON.stringify(name)}${prop.required ? "" : "?"}: ${child(prop.schema)}`)
        if (schema.indexType) properties.push(`[key: string]: ${child(schema.indexType)}`)
        return `{ ${properties.join("; ")} }`
    }
    if (schema instanceof UnionSchema) return `(${schema.types.map(type => `(${child(type)})`).join(" | ")})`
    if (schema instanceof FunctionSchema) return `(...args: ${child(schema.paramsType)}) => ${child(schema.returnType)}`
    if (schema instanceof ComponentTypeSchema) return `import("react").ComponentType<${child(schema.props)}>`
    if (schema instanceof InstanceSchema) {
        const ref = schema.typeRef
        let name: string
        if (ref.kind === "builtin") {
            if (!["Date", "URL", "Map", "Set", "RegExp"].includes(ref.name)) throw new Error(`exportToTsx: unsupported builtin type ${ref.name}`)
            name = ref.name
            const arity = ref.name === "Map" ? 2 : ref.name === "Set" ? 1 : 0
            if (schema.typeArguments.length === 0 && arity > 0) return `${name}<${Array.from({length: arity}, () => "unknown").join(", ")}>`
            if (schema.typeArguments.length !== arity) throw new Error(`exportToTsx: ${name} requires ${String(arity)} type arguments`)
        } else {
            const module = ref.kind === "project" ? resolveProjectPath(ref.sourcePath) : ref.package + (ref.subpath ?? "")
            name = `import(${JSON.stringify(module)}).${ref.exportName}`
            if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(ref.exportName)) throw new Error(`exportToTsx: unsupported class export ${JSON.stringify(ref.exportName)}`)
        }
        return name + (schema.typeArguments.length ? `<${schema.typeArguments.map(child).join(", ")}>` : "")
    }
    switch (schema.name) {
        case "reactNode": return 'import("react").ReactNode'
        case "date": return "Date"
        case "void": case "undefined": case "null": case "never": case "unknown": return schema.name
        default: throw new Error(`exportToTsx: cannot export schema type ${schema.name}; provide an explicit typeSource`)
    }
}
