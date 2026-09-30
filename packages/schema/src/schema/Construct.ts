import {ReactNode} from "react";
import {z, ZodType} from "zod";
import {Schema} from "@/schema/Schema";
import {ArraySchema} from "@/schema/Array";

export type JsValue =
    | JsValue[]
    | { [k:string]: JsValue }
    | ((...args: JsValue[]) => JsValue)
    | string
    | number
    | bigint
    | boolean
    | null
    | undefined
    | Date
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    | ReactNode

interface Construct<Type extends string, Value> { type: Type, value: Value }

export type VoidConstruct = Construct<"void", undefined>
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
    args: Record<string, ValueConstruct>
}>
export type FunctionConstruct = Construct<"function", {
    returnType: Schema
    paramsType: ArraySchema
    func: (...params: unknown[]) => unknown
}>

export type ValueConstruct =
    | {type: "instance", adapterId: string, version: number, value: ValueConstruct}
    | VoidConstruct
    | NullConstruct
    | UndefinedConstruct
    | BooleanConstruct
    | NumberConstruct
    | BigIntConstruct
    | StringConstruct
    | DateConstruct
    | ArrayConstruct
    | ObjectConstruct
    | ElementConstruct
    | FunctionConstruct

function zodConstruct<Type extends string, Value>(type: Type, value: z.ZodType<Value>) {
    return z.object({ type: z.literal(type), value })
}

export const constructSchema = {
    void: zodConstruct("void", z.undefined()),
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
        z.object({type: z.literal("instance"), adapterId: z.string(), version: z.number().int().positive(), value: z.lazy((): ZodType<ValueConstruct> => constructSchema.value)}),
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
