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
            const index = schema.index === undefined ? undefined : {
                ...schema.index,
                value: transformSchema(schema.index.value, transform, topdown)
            } satisfies NonNullable<ObjectTypeSchema["index"]>
            return applyBottomUp({...schema, properties, index})
        }
        case "union": {
            const types = schema.types.map(t => transformSchema(t, transform, topdown))
            return applyBottomUp({ ...schema, types })
        }
    }
}