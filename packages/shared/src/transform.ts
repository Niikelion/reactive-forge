import assert from "assert";
import {
    ArrayTypeSchema, FunctionTypeSchema, mapRecord,
    ObjectTypeSchema,
    PrimitiveTypeSchema, s,
    UnionTypeSchema,
    ValueTypeSchema
} from "./schema";

export type SchemaTransform<T extends { type: string } = never> = {
    transform(schema: ValueTypeSchema<T>): ValueTypeSchema<T> | null
    topdown?: boolean
}

export const mkST = <T extends { type: string } = never>(transform: SchemaTransform<T>["transform"], topdown?: boolean)=> ({
    transform, topdown
})

type BaseApplyHandlerInput<T extends { type: string }> = PrimitiveTypeSchema | ArrayTypeSchema<T> | ObjectTypeSchema<T> | UnionTypeSchema<T> | FunctionTypeSchema<T>
type BaseApplyHandler<T extends { type: string }> = (schema: BaseApplyHandlerInput<T>) => ValueTypeSchema<T>
type InnerApplyHandler<T extends { type: string }> = (schema: ValueTypeSchema<T>) => ValueTypeSchema<T>

export function makeSchemaTransformApplier<T extends { type: string } = never>(apply: (schema: ValueTypeSchema<T>, base: BaseApplyHandler<T>, propagate: InnerApplyHandler<T>) => ValueTypeSchema<T>) {
    function applier(schema: ValueTypeSchema<T>, transform: (schema: ValueTypeSchema<T>) => ValueTypeSchema<T> | null, topdown: boolean = false): ValueTypeSchema<T> {
        const internalApply = (s: ValueTypeSchema<T>) => applier(s, transform, topdown)

        function base(schema: BaseApplyHandlerInput<T>): ValueTypeSchema<T> {
            switch (schema.type) {
                case "void":
                case "any":
                case "never":
                case "unknown":
                case "null":
                case "undefined":
                case "element":
                case "boolean":
                case "number":
                case "string":
                case "date":
                case "bigint":
                    return transformBottomUp(schema)
                case "array": {
                    const tupleTypes = schema.tupleTypes.map(internalApply)
                    const elementType = schema.elementType === undefined ? undefined : internalApply(schema.elementType)
                    return transformBottomUp({...schema, tupleTypes, elementType})
                }
                case "object": {
                    const properties = mapRecord(schema.properties, prop => ({...internalApply(prop), required: prop.required}))
                    const index = schema.index === undefined ? undefined : internalApply(schema.index)

                    return transformBottomUp({...schema, properties, index})
                }
                case "union": {
                    const types = schema.types.map(internalApply)
                    return transformBottomUp({ ...schema, types })
                }
                case "function": {
                    const argumentTypes = schema.arguments.map(internalApply)
                    const returnType = internalApply(schema.returnType)
                    return transformBottomUp({ ...schema, arguments: argumentTypes, returnType})
                }
            }
        }

        if (topdown) {
            let transformed: ValueTypeSchema<T> | null = null
            do {
                transformed = transform(schema)
                if (transformed !== null)
                    schema = transformed
            } while (transformed !== null)
        }

        function transformBottomUp(s: ValueTypeSchema<T>) {
            if (topdown) return s
            return transform(s) ?? s
        }

        return transformBottomUp(apply(schema, base, internalApply))
    }

    return applier
}
export function makeSchemaTransformBatchApplier<T extends { type: string } = never>(applier: (schema: ValueTypeSchema<T>, transform: SchemaTransform<T>["transform"], topdown?: SchemaTransform<T>["topdown"]) => ValueTypeSchema<T>) {
    return function (schema: ValueTypeSchema<T>, transforms: SchemaTransform<T>[]): ValueTypeSchema<T> {
        return transforms.reduce((accSchema, transform) =>
            applier(accSchema, transform.transform, transform.topdown ?? false), schema)
    }
}

export const transformSchema = makeSchemaTransformApplier((schema, base) => base(schema))
export const applySchemaTransforms = makeSchemaTransformBatchApplier(transformSchema)

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

function arrayIntersectionLength(a: ArrayTypeSchema, b: ArrayTypeSchema): number {
    if (a.elementType === undefined && b.elementType === undefined)
        return Math.min(a.tupleTypes.length, b.tupleTypes.length)

    if (a.elementType === undefined)
        return a.tupleTypes.length

    if (b.elementType === undefined)
        return b.tupleTypes.length

    return Math.max(a.tupleTypes.length, b.tupleTypes.length)
}

export function arrayTypeAtIndex(a: ArrayTypeSchema, i: number): ValueTypeSchema {
    if (i < a.tupleTypes.length)
        return a.tupleTypes[i]

    if (a.elementType !== undefined)
        return a.elementType

    throw new Error(`Index ${i} is out of bounds in array type`)
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

            if (merged.length === 0) return s.never()

            return s.union(...merged)
        }
        if (currentSchema.type === "union")
            return intersectionOfSchemas(currentSchema, accSchema) //flip parameters and let previous "if" do the work

        if (accSchema.type === "unknown") return currentSchema
        if (currentSchema.type === "unknown") return accSchema

        if (accSchema.type === "any") return currentSchema
        if (currentSchema.type === "any") return accSchema

        if (accSchema.type === "never" || currentSchema.type === "never") return s.never()

        if (accSchema.type !== currentSchema.type) return s.never()

        switch (accSchema.type) {
            case "void":
            case "null":
            case "undefined":
            case "date":
            case "bigint":
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
                const tupleTypes: ValueTypeSchema[] = []
                const resultTypesLength = arrayIntersectionLength(accSchema, currentSchema)

                for (let i=0; i<resultTypesLength; ++i) {
                    const accType = arrayTypeAtIndex(accSchema, i)
                    const currentType = arrayTypeAtIndex(currentSchema, i)

                    tupleTypes.push(intersectionOfSchemas(accType, currentType))
                }

                return {
                    type: "array",
                    tupleTypes,
                    elementType: intersectionOfOptionals(accSchema.elementType, currentSchema.elementType)
                }
            }
            case "object":
            {
                assert(currentSchema.type === accSchema.type)

                const index = intersectionOfOptionals(accSchema.index, currentSchema.index)
                const properties = intersectionOfProperties(accSchema.properties, currentSchema.properties)

                return {
                    type: "object",
                    properties,
                    index
                }
            }
            case "function": {
                assert(currentSchema.type === accSchema.type)
                const returnType = intersectionOfSchemas(accSchema.returnType, currentSchema.returnType)

                const argumentTypes: ValueTypeSchema[] = []
                const argCount = Math.max(accSchema.arguments.length, currentSchema.arguments.length)

                for (let i=0; i<argCount; ++i) {
                    const arg = intersectionOfOptionals(accSchema.arguments.length > i ? accSchema.arguments[i] : undefined, currentSchema.arguments.length > i ? currentSchema.arguments[i] : undefined)
                    argumentTypes.push(arg ?? s.never())
                }

                return {
                    type: "function",
                    arguments: argumentTypes,
                    returnType
                }
            }
        }
    })
}