import {FC, isValidElement, ReactNode} from "react";
import {ArgumentValue} from "./data";

type ConstantTypeSchema<T extends string> = { type: T }

export type NullTypeSchema = ConstantTypeSchema<"null">
export type UndefinedTypeSchema = ConstantTypeSchema<"undefined">
export type ElementTypeSchema = ConstantTypeSchema<"element">

type ConstantValueTypeSchema<T extends string, V> = ConstantTypeSchema<T> & { value?: V }

export type BooleanTypeSchema = ConstantValueTypeSchema<"boolean", boolean>
export type NumberTypeSchema = ConstantValueTypeSchema<"number", number>
export type StringTypeSchema = ConstantValueTypeSchema<"string", string>
export type DateTypeSchema = ConstantValueTypeSchema<"date", string>

export type PrimitiveTypeSchema = NullTypeSchema | UndefinedTypeSchema | ElementTypeSchema | BooleanTypeSchema | NumberTypeSchema | StringTypeSchema | DateTypeSchema
export type ArrayTypeSchema = {
    type: "array"
    elementType: ValueTypeSchema
}
export type ObjectTypeSchema = {
    type: "object"
    properties: Record<string, ValueTypeSchema & { required: boolean }>
    stringIndex?: ValueTypeSchema
    numberIndex?: ValueTypeSchema
}
export type UnionTypeSchema = {
    type: "union"
    types: ValueTypeSchema[]
}
export type ValueTypeSchema = PrimitiveTypeSchema | ArrayTypeSchema | ObjectTypeSchema | UnionTypeSchema

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
export const isString = (n: unknown): n is string => n instanceof String || typeof n === "string"
export const isObject = (n: unknown): n is Record<string | number, unknown> => n === Object(n)

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
        case "null": return value === null
        case "undefined": return value === undefined
        case "boolean": return isBoolean(value) && (schema.value === undefined || schema.value === value)
        case "number": return isNumber(value) && (schema.value === undefined || schema.value === value)
        case "string": return isString(value) && (schema.value === undefined || schema.value === value)
        case "date": return value instanceof Date
        case "element": return isReactNode(value)
        case "array": return Array.isArray(value) && value.every(v => verifyValue(v, schema.elementType))
        case "object": {
            if (!isObject(value)) return false

            const hasAllRequiredProperties = [...Object.entries(schema.properties)].every(([propName, propSchema]) =>
                (propName in value) || !propSchema.required)

            // Check that every required property is provided
            if (!hasAllRequiredProperties) return false

            return [...Object.entries(value)].every(([propName, propValue]) => {
                // If explicitly defined, check if schema matches
                if (propName in schema.properties && !verifyValue(propValue, schema.properties[propName]))
                    return false

                // If number index exists and index is number, verify with schema from number index
                if (schema.numberIndex !== undefined && !isNaN(Number(propName)))
                    return verifyValue(propValue, schema.numberIndex)

                // If string index exists, check verify with schema from number index
                if (schema.stringIndex !== undefined)
                    return verifyValue(propValue, schema.stringIndex)

                return true
            })
        }
        case "union": return schema.types.some(s => verifyValue(value, s))
    }
}

export function isConstantValueSchema(schema: ValueTypeSchema): boolean {
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