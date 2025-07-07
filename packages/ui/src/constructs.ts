import {createElement} from "react";
import {
    ArgumentValue, ArrayTypeSchema, BigIntTypeSchema, BooleanTypeSchema,
    ComponentLibrary,
    ComponentSchema, DateTypeSchema, ElementTypeSchema,
    isBoolean,
    isNumber,
    isReactNode,
    isString, NullTypeSchema, NumberTypeSchema,
    ObjectTypeSchema, StringTypeSchema,
    ValueTypeSchema,
    verifyValue
} from "@reactive-forge/shared";
import {z, ZodType} from "zod";

type Construct<Type extends string, Value> = { type: Type, value: Value }

export type NullConstruct = Construct<"null", null>
export type UndefinedConstruct = Construct<"undefined", undefined>
export type BooleanConstruct = Construct<"boolean", boolean>
export type NumberConstruct = Construct<"number", number>
export type BigIntConstruct = Construct<"bigint", bigint>
export type StringConstruct = Construct<"string", string>
export type DateConstruct = Construct<"date", string>
export type ArrayConstruct = Construct<"array", ValueConstruct[]>
export type ObjectConstruct = Construct<"object", { [k: string]: ValueConstruct }>
export type ElementConstruct = Construct<"element", {
    path: string
    name: string
    args: { [k: string]: ValueConstruct }
}>
export type ParameterConstruct = Construct<"param", string>
export type VariableConstruct = Construct<"var", string>
export type ValueConstruct = NullConstruct | UndefinedConstruct | BooleanConstruct | NumberConstruct | BigIntConstruct | StringConstruct | DateConstruct | ArrayConstruct | ObjectConstruct | ElementConstruct | ParameterConstruct | VariableConstruct

function construct<T extends ValueConstruct["type"]>(type: T, value: (ValueConstruct & { type: T })["value"])
{
    return { type, value }
}

function zodConstruct<Type extends string, Value>(type: Type, value: z.ZodType<Value>) {
    return z.object({ type: z.literal(type), value })
}

export const constructSchema = {
    null: zodConstruct("null", z.null()),
    undefined: zodConstruct("undefined", z.undefined()),
    boolean: zodConstruct("boolean", z.boolean()),
    number: zodConstruct("number", z.number()),
    bigInt: zodConstruct("bigint", z.bigint()),
    string: zodConstruct("string", z.string()),
    date: zodConstruct("date", z.string()),
    array: zodConstruct("array", z.lazy((): ZodType<ValueConstruct> => constructSchema.value).array()),
    object: zodConstruct("object", z.record(z.lazy((): ZodType<ValueConstruct> => constructSchema.value))),
    element: zodConstruct("element", z.object({
        path: z.string(),
        name: z.string(),
        args: z.record(z.lazy((): ZodType<ValueConstruct> => constructSchema.value))
    })),
    value: z.lazy((): ZodType<ValueConstruct> => z.union([
        constructSchema.null,
        constructSchema.undefined,
        constructSchema.boolean,
        constructSchema.number,
        constructSchema.bigInt,
        constructSchema.string,
        constructSchema.date,
        constructSchema.array,
        constructSchema.object,
        constructSchema.element
    ]))
}

export type NonConstructValue = {
    type: ValueTypeSchema
    value: ArgumentValue
}

function resolveConstruct(value: ValueConstruct, params: Map<string, NonConstructValue>, variables: Map<string, NonConstructValue>, library: ComponentLibrary): ArgumentValue {
    switch (value.type) {
        case "param": {
            const param = params.get(value.value)

            if (param === undefined) throw new Error(`Param ${value.value} does not exist`)

            return param.value
        }
        case "var": {
            const variable = variables.get(value.value)

            if (variable === undefined) throw new Error(`Variable ${value.value} does not exist`)

            return variable.value
        }
    }

    switch (value.type) {
        case "null":
        case "undefined":
        case "boolean":
        case "number":
        case "string": return value.value
        case "element": {
            const component = library.getComponent(value.value.path, value.value.name)

            if (component === null) throw new Error(`Component ${value.value.path}:${value.value.name} not found`)

            const args = resolveElementArgs(value.value.args, component.args, params, variables, library)

            if (!("children" in args))
                return createElement(component.component, args)

            const {children, ...argsWithoutChildren} = args

            if (!isReactNode(children)) throw new Error("Children prop must be a valid react node")

            return createElement(component.component, argsWithoutChildren, ...(Array.isArray(children) ? children : [children]))
        }
        case "date": return new Date(value.value)
        case "array": return value.value.map(v => resolveConstruct(v, params, variables, library))
        case "object": return Object.fromEntries([...Object.entries(value.value)].map(([k, v]) => [k, resolveConstruct(v, params, variables, library)]))
    }
}

function resolveElementArgs(args: Record<string, ValueConstruct>, argsSchema: ComponentSchema["args"], params: Map<string, NonConstructValue>, variables: Map<string, NonConstructValue>, library: ComponentLibrary): Record<string, ArgumentValue> {
    const ret: Record<string, ArgumentValue> = {}

    const usedArgs = new Set<string>()

    for (const prop in args) {
        usedArgs.add(prop)
        const schema = argsSchema[prop]

        if (schema === undefined) throw new Error(`Tried to specify argument ${prop} which is not defined in the component type`)

        ret[prop] = c.resolveConstruct(args[prop], schema, params, variables, library)
    }

    for (const prop in argsSchema)
        if (!usedArgs.has(prop) && argsSchema[prop].required)
            throw new Error(`Argument ${prop} not specified`)

    return ret
}

function constructFromSchema(schema: NullTypeSchema): NullConstruct
function constructFromSchema(schema: UndefinedConstruct): UndefinedConstruct
function constructFromSchema(schema: BooleanTypeSchema): BooleanConstruct
function constructFromSchema(schema: NumberTypeSchema): NumberConstruct
function constructFromSchema(schema: BigIntTypeSchema): BigIntConstruct
function constructFromSchema(schema: StringTypeSchema): StringConstruct
function constructFromSchema(schema: DateTypeSchema): DateConstruct
function constructFromSchema(schema: ArrayTypeSchema): ArrayConstruct
function constructFromSchema(schema: ObjectTypeSchema): ObjectConstruct
function constructFromSchema(schema: ElementTypeSchema): ElementConstruct
function constructFromSchema(schema: ValueTypeSchema): ValueConstruct

function constructFromSchema(schema: ValueTypeSchema): ValueConstruct
{
    switch (schema.type) {
        case "unknown":
        case "any":
        case "null": return c.null()
        case "undefined": return c.undefined()
        case "boolean": return c.boolean(isBoolean(schema.value) ? schema.value ?? false : false)
        case "number": return c.number(isNumber(schema.value) ? schema.value ?? 0 : 0)
        case "bigint": return c.bigint(0n)
        case "string": return c.string(isString(schema.value) ? schema.value ?? "" : "")
        case "date": return c.date(new Date())
        case "array": return c.array(schema.tupleTypes.map(constructFromSchema))
        case "element": return c.element("$", "Empty", {})
        case "object": {
            const props: Record<string, ValueConstruct> = {}

            for (const [propName, propSchema] of Object.entries(schema.properties)) {
                if (!propSchema.required) continue
                props[propName] = constructFromSchema(propSchema)
            }
            return c.object(props)
        }
        case "union": return constructFromSchema(schema.types[0])
        case "function": throw new Error(`Cannot construct value for "function"`)
        case "never": throw new Error(`Cannot construct value for "never"`)
        case "void": throw new Error(`Cannot construct value for "void"`)
    }
}

function constructsEquals(a: ValueConstruct, b: ValueConstruct): boolean {
    if (a.type !== b.type) return false

    switch (a.type) {
        case "null":
        case "undefined":
        case "boolean":
        case "number":
        case "bigint":
        case "string":
        case "var":
        case "param":
            return a.value === b.value
        case "date":
            return new Date(a.value).getDate() === new Date(b.value as string).getDate()
        case "element": {
            const bb = b as ElementConstruct
            return a.value.path === bb.value.path && a.value.name === bb.value.name && constructsEquals(c.object(a.value.args), c.object(bb.value.args))
        }
        case "array": {
            const bb = b as ArrayConstruct
            return a.value.length === bb.value.length && a.value.every((v, i) => constructsEquals(v, bb.value[i]))
        }
        case "object": {
            const bb = b as ObjectConstruct
            if (Object.keys(bb.value).length !== Object.keys(a.value).length)
                return false
            for (const prop in a.value)
                if (!constructsEquals(a.value[prop], bb.value[prop]))
                    return false
            return true
        }
    }
}

export const c = {
    null: () => construct("null", null),
    undefined: () => construct("undefined", undefined),
    boolean: (v: boolean) => construct("boolean", v),
    number: (v: number) => construct("number", v),
    bigint: (v: bigint) => construct("bigint", v),
    string: (v: string) => construct("string", v),
    date: (v: Date) => construct("date", v.toISOString()),
    array: (v: ValueConstruct[]) => construct("array", v),
    object: (v: Record<string, ValueConstruct>) => construct("object", v),
    element: (path: string, name: string, args: Record<string, ValueConstruct>) => construct("element", { path, name, args }),

    resolveConstruct(value: ValueConstruct, schema: ValueTypeSchema, params: Map<string, NonConstructValue>, variables: Map<string, NonConstructValue>, library: ComponentLibrary): ArgumentValue {
        const resolvedValue = resolveConstruct(value, params, variables, library)

        if (!verifyValue(resolvedValue, schema)) throw new Error("Invalid result type")

        return resolvedValue
    },
    constructsEquals,
    constructFromSchema,
    argsConstructsFromSchema(argsSchema: ObjectTypeSchema["properties"]) {
        const props = [...Object.entries(argsSchema)].filter(([,{ required }]) => required)
        return Object.fromEntries(props.map(([propName, propSchema]) => [propName, c.constructFromSchema(propSchema)]))
    }
} as const
