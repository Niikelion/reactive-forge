import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {mapValues} from "remeda";
import {z} from "zod";
import {AsJson, makeSchema, parseJson, schemaFromJson, selfRule} from "@/schema/utils";
import {intersect} from "@/schema/intersection";
import {equals} from "@/schema/equality";

export class ObjectSchema implements Schema {
    readonly name = "object"
    readonly properties: Record<string, { schema: Schema, required: boolean }>
    readonly indexType?: Schema
    readonly exampleConstruct: ValueConstruct

    constructor(properties: Record<string, { schema: Schema, required: boolean }>, indexType?: Schema) {
        this.properties = properties
        this.indexType = indexType
        this.exampleConstruct = c.object(mapValues(properties, p => p.schema.exampleConstruct))
    }

    toJson(): AsJson<typeof ObjectSchema> {
        const properties = mapValues(this.properties, p => ({
            schema: p.schema.toJson(),
            required: p.required,
        }))

        return {type: "object", properties}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        if (construct.type !== "object") return false
        const hasAllRequiredProperties = [...Object.entries(this.properties)].every(([propName, propSchema]) =>
            (propName in construct.value) || !propSchema.required)

        // Check that every required property is provided
        if (!hasAllRequiredProperties) return false

        const hasIndex = this.indexType !== undefined

        return [...Object.entries(construct.value)].every(([propName, propValue]) => {

            // If index exists, verify with index
            if (this.indexType?.verifyConstructType(propValue))
                return false

            // If explicitly defined, verify with property schema
            if (propName in this.properties)
                return this.properties[propName]?.schema.verifyConstructType(propValue) ?? false

            // Not in props, it's ok if we have index because we checked earlier that it matched index schema
            return hasIndex
        })
    }

    withTransformedChildren(transformer: (node: Schema) => Schema): Schema {
        return new ObjectSchema(mapValues(this.properties, p =>
            ({...p, schema: transformer(p.schema)})))
    }

    static readonly jsonSchema = makeSchema("object", {
        properties: z.record(z.object({
            schema: SchemaJson,
            required: z.boolean()
        }))
    })
    static readonly fromJson = (json: SchemaJson): ObjectSchema => {
        return new ObjectSchema(mapValues(parseJson(json, ObjectSchema.jsonSchema).properties, p => ({
            required: p.required,
            schema: schemaFromJson(p.schema)
        })))
    }
    static readonly intersectionRules = [
        selfRule(ObjectSchema, "object", (a, b) => {
            const properties: Record<string, { schema: Schema, required: boolean }> = {}
            const allProps = new Set<string>([...Object.keys(a.properties), ...Object.keys(b.properties)])

            for (const prop of allProps.values()) {
                const aProp = a.properties[prop]
                const bProp = b.properties[prop]

                const schema = intersect(aProp?.schema, bProp?.schema)
                if (!schema) continue
                properties[prop] = { schema, required: (aProp?.required ?? false) || (bProp?.required ?? false) }
            }

            return new ObjectSchema(properties, intersect(a.indexType, b.indexType))
        })
    ]
    static readonly equalityRules = [
        selfRule(ObjectSchema, "object", (a, b) => {
            if (!equals(a.indexType, b.indexType)) return false
            const aKeys = Object.keys(a.properties)
            const bKeys = Object.keys(b.properties)
            const allKeys = new Set([...aKeys, ...bKeys])
            if (allKeys.size !== aKeys.length || allKeys.size !== bKeys.length) return false
            return aKeys.every(p => a.properties[p]?.required === b.properties[p]?.required && equals(a.properties[p]?.schema, b.properties[p]?.schema))
        })
    ]
}