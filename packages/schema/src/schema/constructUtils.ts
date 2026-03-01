import {ArrayConstruct, ElementConstruct, ObjectConstruct, ValueConstruct} from "@/schema/Construct";
import {Schema} from "@/schema/Schema";
import {ArraySchema} from "@/schema/Array";

function construct<T extends ValueConstruct["type"]>(type: T, value: (ValueConstruct & { type: T })["value"])
{
    return { type, value }
}

function constructsEquals(a: ValueConstruct, b: ValueConstruct): boolean {
    if (a.type !== b.type) return false

    switch (a.type) {
        case "void":
        case "null":
        case "undefined": return true
        case "boolean":
        case "number":
        case "bigint":
        case "string":
            return a.value === b.value
        case "date":
            return new Date(a.value).getDate() === new Date(b.value as string).getDate()
        case "element": {
            const bb = b as ElementConstruct
            return a.value.path === bb.value.path && a.value.name === bb.value.name && constructsEquals(c.object(a.value.args), c.object(bb.value.args))
        }
        case "array": {
            const bb = b as ArrayConstruct
            return a.value.length === bb.value.length && a.value.every((v, i) => bb.value[i] && constructsEquals(v, bb.value[i]))
        }
        case "object": {
            const bb = b as ObjectConstruct
            if (Object.keys(bb.value).length !== Object.keys(a.value).length)
                return false
            for (const prop in a.value)
                if (a.value[prop] && bb.value[prop] && !constructsEquals(a.value[prop], bb.value[prop]))
                    return false
            return true
        }
        case "function": {
            //TODO: implement
            throw new Error("cannot compare function constructs")
        }
    }
}

export const c = {
    void: () => construct("void", undefined),
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
    function: (func: (...params: unknown[]) => unknown, returnType: Schema, paramsType: ArraySchema) => construct("function", { returnType, paramsType, func }),
    equals: constructsEquals,
} as const
