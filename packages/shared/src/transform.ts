import assert from "assert";
import {ObjectTypeSchema, ValueTypeSchema} from "./schema";

export type SchemaTransform = {
    transform(schema: ValueTypeSchema): ValueTypeSchema | null
    topdown?: boolean
}

export function applySchemaTransforms(schema: ValueTypeSchema, transforms: SchemaTransform[]): ValueTypeSchema
{
    return transforms.reduce((accSchema, transform) =>
        transformSchema(accSchema, transform.transform, transform.topdown ?? false), schema)
}

export const mkST = (transform: SchemaTransform["transform"], topdown?: boolean)=> ({
    transform, topdown
})

export function transformSchema(schema: ValueTypeSchema, transform: (schema: ValueTypeSchema) => ValueTypeSchema | null, topdown: boolean = false): ValueTypeSchema {
    if (topdown) {
        let transformed: ValueTypeSchema | null = null
        do {
            transformed = transform(schema)
            if (transformed !== null)
                schema = transformed
        } while (transformed !== null)
    }

    function applyBottomUp(s: ValueTypeSchema) {
        if (topdown) return s
        return transform(s) ?? s
    }

    switch (schema.type) {
        case "element":
        case "date":
        case "string":
        case "number":
        case "boolean":
        case "undefined":
        case "null":
            return applyBottomUp(schema)
        case "array": {
            const elementType = transformSchema(schema.elementType, transform, topdown)
            return applyBottomUp({...schema, elementType})
        }
        case "object": {
            const properties = Object.fromEntries([...Object.entries(schema.properties)]
                .map(([propName, {required, ...propSchema}]) =>
                    [propName, { ...transformSchema(propSchema, transform, topdown), required }]
                )
            )
            const stringIndex = schema.stringIndex === undefined ? undefined : transformSchema(schema.stringIndex, transform, topdown)
            const numberIndex = schema.numberIndex === undefined ? undefined : transformSchema(schema.numberIndex, transform, topdown)

            return applyBottomUp({...schema, properties, stringIndex, numberIndex})
        }
        case "union": {
            const types = schema.types.map(t => transformSchema(t, transform, topdown))
            return applyBottomUp({ ...schema, types })
        }
    }
}

function intersectionOfValues<T>(a: T | undefined, b: T | undefined) {
    if (a === undefined || b === undefined || a === b)
        return a ?? b

    throw new Error(`Cannot merge ${a} and ${b}`)
}

function intersectionOfOptionals(a: ValueTypeSchema | undefined, b: ValueTypeSchema | undefined) {
    if (a === undefined || b === undefined)
        return a ?? b

    return intersectionOfSchemas(a, b)
}

function intersectionOfProperties(a: ObjectTypeSchema["properties"], b: ObjectTypeSchema["properties"]) {
    const props: ObjectTypeSchema["properties"] = {}

    const allProps = new Set<string>([...Object.keys(a), ...Object.keys(b)])

    for (const prop of allProps.values()) {
        const schema = intersectionOfOptionals(a[prop], b[prop])!
        props[prop] = {
            ...schema,
            required: (a[prop]?.required ?? false) || (b[prop]?.required ?? false)
        }
    }

    return props
}

export function intersectionOfSchemas(...schemas: ValueTypeSchema[]): ValueTypeSchema {
    return schemas.reduce((accSchema, currentSchema): ValueTypeSchema => {
        if (accSchema.type === "union") {
            const merged = accSchema.types.map(schema => {
                try {
                    return intersectionOfSchemas(schema, currentSchema)
                } catch {
                    return null
                }
            }).filter(s => s !== null)

            if (merged.length === 0)
                throw new Error("None of the union variants matched")

            return {
                type: "union",
                types: merged
            }
        }
        if (currentSchema.type === "union")
            return intersectionOfSchemas(currentSchema, accSchema) //flip parameters and let previous "if" do the work

        if (accSchema.type !== currentSchema.type) throw new Error(`Cannot merge ${accSchema.type} and ${currentSchema.type}`)

        switch (accSchema.type) {
            case "null":
            case "undefined":
            case "date":
            case "element":
                return accSchema
            case "boolean": {
                assert(currentSchema.type === accSchema.type)
                return {
                    type: accSchema.type,
                    value: intersectionOfValues(accSchema.value, currentSchema.value)
                }
            }
            case "number": {
                assert(currentSchema.type === accSchema.type)
                return {
                    type: accSchema.type,
                    value: intersectionOfValues(accSchema.value, currentSchema.value)
                }
            }
            case "string": {
                assert(currentSchema.type === accSchema.type)
                return {
                    type: accSchema.type,
                    value: intersectionOfValues(accSchema.value, currentSchema.value)
                }
            }
            case "array": {
                assert(currentSchema.type === accSchema.type)
                return {
                    type: accSchema.type,
                    elementType: intersectionOfSchemas(accSchema.elementType, currentSchema.elementType)
                }
            }
            case "object":
            {
                assert(currentSchema.type === accSchema.type)

                const stringIndex = intersectionOfOptionals(accSchema.stringIndex, currentSchema.stringIndex)
                const numberIndex = intersectionOfOptionals(accSchema.numberIndex, currentSchema.numberIndex)

                const properties = intersectionOfProperties(accSchema.properties, currentSchema.properties)

                return {
                    type: "object",
                    properties,
                    stringIndex,
                    numberIndex
                }
            }
        }
    })
}