import {ConstantValueSchema, isConstantValueSchema, ValueTypeSchema} from "@reactive-forge/shared";

export type PrimitiveUnionTypeSchema = {
    type: "primitiveUnion"
    types: ConstantValueSchema[]
}

export const extractPrimitiveUnion = (schema: ValueTypeSchema): PrimitiveUnionTypeSchema | null => {
    if (schema.type !== "union") return null

    if (!schema.types.every(isConstantValueSchema)) return null

    return {
        type: "primitiveUnion",
        types: schema.types
    }
}