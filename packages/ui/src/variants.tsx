import {ObjectTypeSchema, UnionTypeSchema} from "@reactive-forge/shared";

export type VariantTypeSchema = {
    type: "variant"
    property: {
        type: "string" | "number" | "boolean"
        name: string
    }
    variants: Record<string, ObjectTypeSchema>
}

export const variantSchemaToUnionSchema = (schema: VariantTypeSchema): UnionTypeSchema => ({
    type: "union",
    types: Object.values(schema.variants)
})

export const unionSchemaToVariantSchema = (schema: UnionTypeSchema): VariantTypeSchema | null => {
    const variants: ObjectTypeSchema[] = []

    for (const type of schema.types) {
        if (type.type !== "object") return null

        variants.push(type)
    }

    const commonProperties = variants.reduce((acc, variant) =>
        acc.intersection(new Set<string>(Object.keys(variant.properties))), new Set<string>())

    if (commonProperties.size !== 1) return null

    const [ typePropName ] = commonProperties.values()

    const resolvedVariants: {
        type: VariantTypeSchema["property"]["type"]
        value: string
        variant: ObjectTypeSchema
    }[] = []

    for (const variant of variants) {
        const prop = variant.properties[typePropName]
        if (!prop.required) return null
        switch (prop.type) {
            case "string":
            case "number":
            case "boolean": {
                // we only accept literal values
                if (prop.value === undefined) return null
                resolvedVariants.push({
                    variant,
                    type: prop.type,
                    value: prop.value.toString()
                })
                break
            }
            case "union": {
                // we only accept unions of literal values
                if (!prop.types.every(t => (t.type === "string" || t.type === "number" || t.type === "boolean") && t.value !== undefined)) return null
                for (const t of prop.types) {
                    if (t.type !== "string" && t.type !== "number" && t.type !== "boolean") continue
                    resolvedVariants.push({
                        variant,
                        type: t.type,
                        value: t.value!.toString()
                    })
                }
                break
            }
            // we don't accept other values for keys
            default: return null
        }
    }

    if (resolvedVariants.length === 0) return null

    const type = resolvedVariants.reduce<"string" | "number" | "boolean" | null>((acc, v) => {
        if (acc !== v.type) return null
        return acc
    }, resolvedVariants[0].type)

    if (type === null) return null

    return {
        type: "variant",
        property: { type, name: typePropName },
        variants: Object.fromEntries(resolvedVariants.map(v => [ v.value, v.variant ]))
    }
}