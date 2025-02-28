import {createElement} from "react";
import {
    ArgumentValue,
    ComponentLibrary,
    ComponentSchema,
    isBoolean, isNumber,
    isReactNode, isString,
    ValueTypeSchema,
    verifyValue
} from "@reactive-forge/shared";

type Construct<Type extends string, Value> = { type: Type, value: Value }

export type NullConstruct = Construct<"null", null>
export type UndefinedConstruct = Construct<"undefined", undefined>
export type BooleanConstruct = Construct<"boolean", boolean>
export type NumberConstruct = Construct<"number", number>
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
export type ValueConstruct = NullConstruct | UndefinedConstruct | BooleanConstruct | NumberConstruct | StringConstruct | DateConstruct | ArrayConstruct | ObjectConstruct | ElementConstruct | ParameterConstruct | VariableConstruct

function construct<T extends ValueConstruct["type"]>(type: T, value: (ValueConstruct & { type: T })["value"])
{
    return { type, value }
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

function constructFromSchema(schema: ValueTypeSchema, allowInvalid?: boolean): ValueConstruct | null
{
    switch (schema.type) {
        case "null": return c.null()
        case "undefined": return c.undefined()
        case "boolean": return c.boolean(isBoolean(schema.value) ? schema.value ?? false : false)
        case "number": return c.number(isNumber(schema.value) ? schema.value ?? 0 : 0)
        case "string": return c.string(isString(schema.value) ? schema.value ?? "" : "")
        case "date": return c.date(new Date())
        case "array": return c.array([])
        case "element": return c.element("$", "Empty", {})
        case "object": {
            const props: Record<string, ValueConstruct> = {}

            for (const [propName, propSchema] of Object.entries(schema.properties)) {
                if (!propSchema.required) continue

                const value = constructFromSchema(propSchema, allowInvalid)

                if (value === null) return null

                props[propName] = value
            }
            return c.object(props)
        }
        case "union": {
            for (const type of schema.types)
            {
                const value = constructFromSchema(type, allowInvalid)
                if (value === null) continue

                return value
            }
            return null
        }
        default: return null
    }
}

export const c = {
    null: () => construct("null", null),
    undefined: () => construct("undefined", undefined),
    boolean: (v: boolean) => construct("boolean", v),
    number: (v: number) => construct("number", v),
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
    constructFromSchema
} as const
