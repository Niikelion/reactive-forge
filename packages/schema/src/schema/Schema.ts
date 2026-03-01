import {z, ZodType} from "zod";
import {ValueConstruct} from "@/schema/Construct";

export type Json = null | undefined | string | number | bigint | boolean | Json[] | { [key: string]: Json }
export const Json: ZodType<Json> = z.union([
    z.null(),
    z.undefined(),
    z.string(),
    z.number(),
    z.bigint(),
    z.boolean(),
    z.lazy(() => Json.array()),
    z.lazy(() => z.record(Json))
])

export interface SchemaJson {
    type: string
    [key: string]: Json
}
export const SchemaJson = z.object({type: z.string()}).catchall(Json)

export interface Schema {
    readonly name: string
    readonly exampleConstruct: ValueConstruct

    toJson(): SchemaJson
    verifyConstructType(construct: ValueConstruct): boolean
    withTransformedChildren(transformer: (node: Schema) => Schema): Schema
}

export type SchemaFactory = (json: SchemaJson) => Schema

const schemaFactoryRegistry = new Map<string, SchemaFactory>()

export function registerSchemaFactory(name: string, factory: SchemaFactory) {
    if (schemaFactoryRegistry.has(name)) throw new Error(`Cannot override schema factory for ${name}`)
    schemaFactoryRegistry.set(name, factory)
}

export function registerSchemaFactories(factories: Record<string, SchemaFactory> | ({ name: string, factory: SchemaFactory }[])): void {
    const list = Array.isArray(factories) ? factories : Object.entries(factories).map(([name, factory]) => ({ name, factory }))

    for (const { name, factory } of list)
        registerSchemaFactory(name, factory)
}

export function getSchemaFactory(name: string, required: true): SchemaFactory
export function getSchemaFactory(name: string): SchemaFactory | null
export function getSchemaFactory(name: string, required?: boolean): SchemaFactory | null {
    const schema = schemaFactoryRegistry.get(name) ?? null
    
    if (required && !schema) throw new Error(`Could not find factory for type ${name}`)
    return schema
}