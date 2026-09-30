import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {AsJson, makeSchema, parseJson, schemaFromJson, selfRule} from "@/schema/utils";
import {intersect} from "@/schema/intersection";
import {equals} from "@/schema/equality";

export class ArraySchema implements Schema {
    readonly name = "array"
    readonly indexType?: Schema
    readonly tupleTypes: Schema[]
    readonly exampleConstruct: ValueConstruct

    constructor(tupleTypes: Schema[], indexType?: Schema) {
        this.indexType = indexType
        this.tupleTypes = tupleTypes
        this.exampleConstruct = c.array(tupleTypes.map(t => t.exampleConstruct))
    }

    toJson(): AsJson<typeof ArraySchema> {
        return {
            type: "array",
            tupleTypes: this.tupleTypes.map(tupleType => tupleType.toJson()),
            ...(this.indexType ? {indexType: this.indexType.toJson()} : {})
        }
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        if (construct.type !== "array" || construct.value.length < this.tupleTypes.length) return false
        return construct.value.every((c, i) =>
            i < this.tupleTypes.length
                ? this.tupleTypes[i]?.verifyConstructType(c) ?? false
                : this.indexType ? this.indexType.verifyConstructType(c) : false
        )
    }

    withTransformedChildren(transformer: (node: Schema) => Schema): ArraySchema {
        return new ArraySchema(
            this.tupleTypes.map(transformer),
            this.indexType ? transformer(this.indexType) : undefined
        )
    }

    typeAtIndex(index: number): Schema {
        const schema = this.tupleTypes[index] ?? this.indexType

        if (!schema)
            throw new Error(`Index ${index.toString()} is out of bounds in array type`)

        return schema
    }

    static readonly jsonSchema = makeSchema("array", {
        indexType: SchemaJson.optional(),
        tupleTypes: SchemaJson.array()
    })
    static readonly fromJson = (json: SchemaJson): ArraySchema => {
        const parsedJson = parseJson(json, ArraySchema.jsonSchema)

        const indexType = parsedJson.indexType ? schemaFromJson(parsedJson.indexType) : undefined
        const tupleTypes = parsedJson.tupleTypes.map(schemaFromJson)
        return new ArraySchema(tupleTypes, indexType)
    }
    static readonly intersectionRules = [
        selfRule(ArraySchema, "array", (a, b) => {
            const tupleTypes: Schema[] = []
            const resultTypesLength = arrayIntersectionLength(a, b)

            for (let i=0; i<resultTypesLength; ++i) {
                tupleTypes.push(intersect(a.typeAtIndex(i), b.typeAtIndex(i)))
            }

            return new ArraySchema(tupleTypes, intersect(a.indexType, b.indexType))
        })
    ]
    static readonly equalityRules = [
        selfRule(ArraySchema, "array", (a, b) => {
            if (!equals(a.indexType, b.indexType)) return false
            if (a.tupleTypes.length !== b.tupleTypes.length) return false
            return a.tupleTypes.every((t, i) => equals(t, b.tupleTypes[i]))
        })
    ]
}

function arrayIntersectionLength(a: ArraySchema, b: ArraySchema): number {
    if (a.indexType === undefined && b.indexType === undefined)
        return Math.min(a.tupleTypes.length, b.tupleTypes.length)

    if (a.indexType === undefined)
        return a.tupleTypes.length

    if (b.indexType === undefined)
        return b.tupleTypes.length

    return Math.max(a.tupleTypes.length, b.tupleTypes.length)
}

