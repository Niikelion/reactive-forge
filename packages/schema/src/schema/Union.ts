import {Json, Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {AsJson, makeSchema, parseJson, rule, schemaFromJson, selfRule} from "@/schema/utils";
import {intersect} from "@/schema/intersection";
import {NeverSchema} from "@/schema/Never";
import {equals} from "@/schema/equality";

function sortKey(value: Json): string {
    if (value === null || value === undefined) return String(value)
    if (typeof value === 'bigint') return `bigint:${String(value)}`
    if (typeof value !== 'object') return String(value)
    if (Array.isArray(value)) return `[${value.map(sortKey).join(',')}]`
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${sortKey(v)}`).join(',')}}`
}

export class UnionSchema implements Schema {
    readonly name = "union"
    readonly types: Schema[]
    readonly exampleConstruct: ValueConstruct

    constructor(types: Schema[]) {
        const sorted = [...types].sort((a, b) => sortKey(a.toJson()).localeCompare(sortKey(b.toJson())))
        const first = sorted[0]
        if (!first) throw new Error("Union schema requires at least one union type")
        this.types = sorted
        this.exampleConstruct = first.exampleConstruct
    }

    toJson(): AsJson<typeof UnionSchema> {
        return {type: "union", types: this.types.map(t => t.toJson())}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return this.types.some(t => t.verifyConstructType(construct))
    }

    withTransformedChildren(transformer: (node: Schema) => Schema): UnionSchema {
        return new UnionSchema(this.types.map(transformer))
    }

    static readonly jsonSchema = makeSchema("union", {types: SchemaJson.array().min(1)})
    static readonly fromJson = (json: SchemaJson): Schema => {
        return new UnionSchema(parseJson(json, UnionSchema.jsonSchema).types.map(schemaFromJson))
    }
    static readonly intersectionRules = [
        rule("union&", (union, schema) => {
            if (!(union instanceof UnionSchema)) return NeverSchema.instance

            const types = union.types
                .map(t => intersect(t, schema))
                .filter(t => !equals(t, NeverSchema.instance))
                .flatMap(t => t instanceof UnionSchema ? t.types: [t])

            if (types.length === 0) return NeverSchema.instance
            if (types.length === 1 && types[0]) return types[0]
            return new UnionSchema(types)
        }, 2)
    ]
    static readonly equalityRules = [
        selfRule(UnionSchema, "union", (a, b) =>
            a.types.length === b.types.length && a.types.every((v, i) => equals(v, b.types[i]))
        )
    ]
}