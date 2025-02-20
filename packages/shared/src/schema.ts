import {FC, isValidElement, ReactNode} from "react";
import {ArgumentValue} from "./data";
import * as stream from "node:stream";

export type PrimitiveTypeSchema = {
    type: "string" | "boolean" | "number" | "undefined" | "null" | "date" | "element"
    value?: string | number | boolean | undefined
}
export type ArrayTypeSchema = {
    type: "array"
    elementType: ValueTypeSchema
}
export type ObjectTypeSchema = {
    type: "object"
    properties: Record<string, ValueTypeSchema & { required: boolean }>
}
export type UnionTypeSchema = {
    type: "union"
    types: ValueTypeSchema[]
}
//TODO: maybe propagate intersections?
export type IntersectionTypeSchema = {
    type: "intersection"
    types: ValueTypeSchema[]
}
export type ValueTypeSchema = PrimitiveTypeSchema | ArrayTypeSchema | ObjectTypeSchema | UnionTypeSchema | IntersectionTypeSchema

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
export const isObject = (n: unknown): n is Record<string, unknown> => n === Object(n)

export function isReactNode(value: ArgumentValue): value is ReactNode {
    if (value === null || value === undefined || isBoolean(value) || isNumber(stream) || isString(value))
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

            const definedProperties = new Set<string>(Object.keys(schema.properties))
            for (const prop in value)
                if (!definedProperties.has(prop))
                    return false

            return [...Object.entries(schema.properties)].every(([propName, propSchema]) => {
                if (!(propName in value)) return !propSchema.required

                return verifyValue(value[propName], propSchema)
            })
        }
        case "union": return schema.types.some(s => verifyValue(value, s))
        case "intersection": return schema.types.every(s => verifyValue(value ,s))
    }
}