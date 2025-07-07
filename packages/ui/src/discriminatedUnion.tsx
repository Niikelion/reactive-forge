import {ObjectTypeSchema, ValueTypeSchema} from "@reactive-forge/shared";
import {BooleanConstruct, c, NullConstruct, NumberConstruct, StringConstruct, UndefinedConstruct} from "./constructs";

type PropConstruct = NullConstruct | UndefinedConstruct | BooleanConstruct | NumberConstruct | StringConstruct

export type DiscriminatedUnionTypeSchema = {
    type: "discriminatedUnion"
    property: string
    types: {
        schema: ObjectTypeSchema
        propertyValue: PropConstruct
    }[]
}

export const extractDiscriminatedUnion = (schema: ValueTypeSchema): DiscriminatedUnionTypeSchema | null => {
    if (schema.type !== "union") return null

    const types: ObjectTypeSchema[] = []

    for (const type of schema.types) {
        if (type.type !== "object") return null

        types.push(type)
    }

    const commonProperties = types.reduce((acc, variant) =>
        acc.intersection(new Set<string>(Object.keys(variant.properties))), new Set<string>())

    if (commonProperties.size !== 1) return null

    const [ typePropName ] = commonProperties.values()

    const resolvedVariants: DiscriminatedUnionTypeSchema["types"] = []

    for (const unionVariant of types) {
        const prop = unionVariant.properties[typePropName]
        if (!prop.required) return null

        function getPropValue(s: ValueTypeSchema) {
            switch (s.type) {
                case "null": return c.null()
                case "undefined": return c.undefined()
                case "boolean": return s.value === undefined ? null : c.boolean(s.value)
                case "number": return s.value === undefined ? null : c.number(s.value)
                case "string": return s.value === undefined ? null : c.string(s.value)
                default: return null
            }
        }

        if (prop.type === "union") {
            // we only accept unions of literal values
            if (!prop.types.every(t => (t.type === "string" || t.type === "number" || t.type === "boolean") && t.value !== undefined)) return null
            for (const t of prop.types) {
                const propValue = getPropValue(t)
                if (propValue === null) continue
                resolvedVariants.push({
                    schema: unionVariant,
                    propertyValue: propValue
                })
            }
            continue
        }

        const propValue = getPropValue(prop)
        if (propValue === null) return null

        resolvedVariants.push({
            schema: unionVariant,
            propertyValue: propValue
        })
    }

    if (resolvedVariants.length === 0) return null

    return {
        type: "discriminatedUnion",
        property: typePropName,
        types: resolvedVariants
    }
}