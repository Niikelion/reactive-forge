import {FC, isValidElement, ReactNode} from "react";
import {ArgumentValue} from "./data";

type ConstantTypeSchema<T extends string> = { type: T }

export type VoidTypeSchema = ConstantTypeSchema<"void">
export type NeverTypeSchema = ConstantTypeSchema<"never">
export type UnknownTypeSchema = ConstantTypeSchema<"unknown">
export type AnyTypeSchema = ConstantTypeSchema<"any">
export type NullTypeSchema = ConstantTypeSchema<"null">
export type UndefinedTypeSchema = ConstantTypeSchema<"undefined">
export type ElementTypeSchema = ConstantTypeSchema<"element">
export type DateTypeSchema = ConstantTypeSchema<"date">

type ConstantValueTypeSchema<T extends string, V> = ConstantTypeSchema<T> & { value?: V }

export type BooleanTypeSchema = ConstantValueTypeSchema<"boolean", boolean>
export type NumberTypeSchema = ConstantValueTypeSchema<"number", number>
export type StringTypeSchema = ConstantValueTypeSchema<"string", string>
export type BigIntTypeSchema = ConstantValueTypeSchema<"bigint", bigint>

export type PrimitiveTypeSchema = VoidTypeSchema | NeverTypeSchema | UnknownTypeSchema | AnyTypeSchema | NullTypeSchema | UndefinedTypeSchema | ElementTypeSchema | BooleanTypeSchema | NumberTypeSchema | StringTypeSchema | DateTypeSchema | BigIntTypeSchema
export type ArrayTypeSchema<T extends ConstantTypeSchema<string> = never> = {
    type: "array"
    elementType?: ValueTypeSchema<T>
    tupleTypes: ValueTypeSchema<T>[]
}
export type ObjectTypeSchema<T extends ConstantTypeSchema<string> = never> = {
    type: "object"
    properties: Record<string, ValueTypeSchema<T> & { required: boolean }>
    index?: ValueTypeSchema<T>
}
export type FunctionTypeSchema<T extends ConstantTypeSchema<string> = never> = {
    type: "function"
    returnType: ValueTypeSchema<T>
    arguments: ValueTypeSchema<T>[]
}

export type UnionTypeSchema<T extends ConstantTypeSchema<string> = never> = {
    type: "union"
    types: ValueTypeSchema<T>[]
}
export type ValueTypeSchema<T extends ConstantTypeSchema<string> = never> = PrimitiveTypeSchema | ArrayTypeSchema<T> | ObjectTypeSchema<T> | FunctionTypeSchema<T> | UnionTypeSchema<T> | T

export type PickValueTypeSchema<T extends ValueTypeSchema["type"]> = ValueTypeSchema & { type: T }

export type ComponentSchema = Readonly<{
    component: FC<Record<string, ArgumentValue>>,
    args: ObjectTypeSchema["properties"]
}>

export class ComponentFile
{
    public readonly path: string
    public readonly components: Map<string, ComponentSchema> = new Map()

    public constructor(path: string, components: Record<string, ComponentSchema>) {
        this.path = path
        for (const prop in components)
            this.components.set(prop, components[prop])
    }
}

export class ComponentLibrary
{
    private library: Map<string, ComponentFile> = new Map()

    public constructor(...files: ComponentFile[]) {
        for (const file of files)
            this.library.set(file.path, file)
    }

    public getFile(path: string): ComponentFile | null {
        return this.library.get(path) ?? null
    }
    public getComponent(path: string, name: string): ComponentSchema | null {
        return this.getFile(path)?.components.get(name) ?? null
    }
    public listFiles(): ComponentFile[] {
        return [...this.library.values()]
    }
}

export const isBoolean = (n: unknown): n is boolean => n instanceof Boolean || typeof n === "boolean"
export const isNumber = (n: unknown): n is number => n instanceof Number || typeof n === "number"
export const isBigInt = (n: unknown): n is bigint => typeof n === "bigint"
export const isString = (n: unknown): n is string => n instanceof String || typeof n === "string"
export const isDate = (n: unknown): n is Date => n instanceof Date
export const isObject = (n: unknown): n is Record<string | number, unknown> => n === Object(n)
export const isFunction = (n: unknown): n is ((...args: any[]) => any) => n instanceof Function

export function isReactNode(value: ArgumentValue): value is ReactNode {
    if (value === null || value === undefined || isBoolean(value) || isNumber(value) || isString(value))
        return true

    if (isValidElement(value))
        return true

    if (Array.isArray(value))
        return value.every(isReactNode)

    return false
}

export function verifyValue(value: ArgumentValue, schema: ValueTypeSchema): boolean {
    switch (schema.type) {
        case "void": return false
        case "never": return false
        case "unknown": return true
        case "any": return true
        case "null": return value === null
        case "undefined": return value === undefined
        case "boolean": return isBoolean(value) && (schema.value === undefined || schema.value === value)
        case "number": return isNumber(value) && (schema.value === undefined || schema.value === value)
        case "bigint": return isBigInt(value)
        case "string": return isString(value) && (schema.value === undefined || schema.value === value)
        case "date": return isDate(value)
        case "element": return isReactNode(value)
        case "array": return Array.isArray(value) && value.length >= schema.tupleTypes.length && value.every((v, i) => {
            if (i >= schema.tupleTypes.length)
                return schema.elementType !== undefined && verifyValue(v, schema.elementType)
            return verifyValue(v, schema.tupleTypes[i]);
        })
        case "object": {
            if (!isObject(value)) return false

            const hasAllRequiredProperties = [...Object.entries(schema.properties)].every(([propName, propSchema]) =>
                (propName in value) || !propSchema.required)

            // Check that every required property is provided
            if (!hasAllRequiredProperties) return false

            const hasIndex = schema.index !== undefined

            return [...Object.entries(value)].every(([propName, propValue]) => {

                // If index exists, verify with index
                if (hasIndex && !verifyValue(propValue, schema.index!))
                    return false

                // If explicitly defined, verify with property schema
                if (propName in schema.properties)
                    return verifyValue(propValue, schema.properties[propName])

                // Not in props, it's ok if we have index because we checked earlier that it matched index schema
                return hasIndex
            })
        }
        case "function": return false
        case "union": return schema.types.some(s => verifyValue(value, s))
    }
}

export type ConstantValueSchema =
    VoidTypeSchema |
    NeverTypeSchema |
    UnknownTypeSchema |
    AnyTypeSchema |
    NullTypeSchema |
    UndefinedTypeSchema |
    (BooleanTypeSchema & { value: boolean }) |
    (NumberTypeSchema & { value: number }) |
    (StringTypeSchema & { value: string })

export function isConstantValueSchema(schema: ValueTypeSchema): schema is ConstantValueSchema {
    switch (schema.type) {
        case "null":
        case "undefined":
            return true
        case "boolean":
        case "number":
        case "string":
            return schema.value !== undefined
    }
    return false
}

function schema<T extends ValueTypeSchema["type"], R extends Omit<PickValueTypeSchema<T>, "type">>(type: T, value: R): { type: T } & R {
    return { type, ...value }
}

export const s = {
    void: () => schema("void", {}),
    never: () => schema("never", {}),
    any: () => schema("any", {}),
    unknown: () => schema("unknown", {}),
    null: () => schema("null", {}),
    undefined: () => schema("undefined", {}),
    date: () => schema("date", {}),
    element: () => schema("element", {}),
    boolean: <T extends BooleanTypeSchema["value"]>(value: T) => schema("boolean", { value } as const),
    number: <T extends NumberTypeSchema["value"]>(value: T) => schema("number", { value } as const),
    bigint: <T extends BigIntTypeSchema["value"]>(value: T) => schema("bigint", { value } as const),
    string: <T extends StringTypeSchema["value"]>(value: T) => schema("string", { value } as const),
    array: <T extends ArrayTypeSchema["elementType"]>(elementType: T) => schema("array", { elementType, tupleTypes: [] } as const),
    tuple: <T extends ArrayTypeSchema["tupleTypes"]>(...tupleTypes: T) => schema("array", { tupleTypes } as const),
    object: <T extends ObjectTypeSchema["properties"], I extends ObjectTypeSchema["index"]>(properties: T, index?: I) => schema("object", { properties, index } as const),
    record: <T extends NonNullable<ObjectTypeSchema["index"]>>(index: T) => schema("object", { properties: {}, index } as const),
    function: <R extends ValueTypeSchema, A extends ValueTypeSchema[]>(returnType: R, ...args: A) => schema("function", { returnType, arguments: args } as const),
    union: <T extends ValueTypeSchema[]>(...types: T) => schema("union", { types } as const)
}

type DispatchSource =
    | ((v: VoidTypeSchema) => void)
    | ((v: NeverTypeSchema) => never)
    | ((v: AnyTypeSchema) => any)
    | ((v: UnknownTypeSchema) => unknown)
    | ((v: NullTypeSchema) => null)
    | ((v: UndefinedTypeSchema) => undefined)
    | ((v: DateTypeSchema) => Date)
    | ((v: ElementTypeSchema) => ReactNode)

type BatchDispatch<T, A> = T extends (...args: infer Args) => infer R
    ? A extends Args[0]
        ? R
        : never
    : never;

type DispatchConstantValueType<T, S extends ConstantValueTypeSchema<string, any>, V, D> = T extends S ? undefined extends T["value"] ? V : T["value"] : D
type DispatchBoolean<T, D> = DispatchConstantValueType<T, BooleanTypeSchema, boolean, D>
type DispatchNumber<T, D> = DispatchConstantValueType<T, NumberTypeSchema, number, D>
type DispatchString<T, D> = DispatchConstantValueType<T, StringTypeSchema, string, D>

type DispatchPrimitiveTypes<T> = DispatchString<T, DispatchNumber<T, DispatchBoolean<T, BatchDispatch<DispatchSource, T>>>>

type DispatchTupleType<T extends ArrayTypeSchema["tupleTypes"]> = T extends [ValueTypeSchema, ...ValueTypeSchema[]] ? { [K in keyof T]: inferFromSchema<T[K]> } : []
type DispatchArray<T, D> = T extends ArrayTypeSchema ? T["elementType"] extends ValueTypeSchema ? [...DispatchTupleType<T["tupleTypes"]>, ...inferFromSchema<T["elementType"]>[]] : DispatchTupleType<T["tupleTypes"]> : D

type DispatchIndex<T extends ValueTypeSchema | undefined> = T extends ValueTypeSchema ? { [k: string]: inferFromSchema<T> } : {}
type DispatchProperties<T extends ObjectTypeSchema["properties"]> = {
    -readonly [K in keyof T as T[K]["required"] extends false ? K : never]?: inferFromSchema<T[K]>
} & {
    -readonly [K in keyof T as T[K]["required"] extends false ? never : K]-?: inferFromSchema<T[K]>
}

type DispatchObject<T, D> = T extends ObjectTypeSchema ? DispatchProperties<T["properties"]> & DispatchIndex<T["index"]> : D

type DispatchUnionTypes<T extends ValueTypeSchema[]> = T extends [infer First extends ValueTypeSchema, ...(infer Rest extends ValueTypeSchema[])] ? inferFromSchema<First> | DispatchUnionTypes<Rest> : never
type DispatchUnion<T, D> = T extends UnionTypeSchema ? DispatchUnionTypes<T["types"]> : D

type DispatchFunction<T, D> = T extends FunctionTypeSchema ? ((...args: DispatchTupleType<T["arguments"]>) => inferFromSchema<T["returnType"]>) : D

export type inferFromSchema<T extends ValueTypeSchema> = DispatchArray<T, DispatchObject<T, DispatchUnion<T, DispatchFunction<T, DispatchPrimitiveTypes<T>>>>>

export function mapRecord<K extends string, T, R>(record: Record<K, T>, map: (v: T) => R): Record<K, R>
{
    return Object.fromEntries([...Object.entries<T>(record)].map(([k, v]) => [k, map(v)])) as Record<K, R>
}