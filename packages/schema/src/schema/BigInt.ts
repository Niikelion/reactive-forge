import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {z} from "zod";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";
import {NeverSchema} from "@/schema/Never";

export class BigIntSchema implements Schema {
    readonly name = "bigint"
    readonly literal?: bigint
    readonly exampleConstruct: ValueConstruct

    constructor(literal?: bigint) {
        this.literal = literal
        this.exampleConstruct = c.bigint(literal ?? 0n)
    }

    toJson(): AsJson<typeof BigIntSchema> {
        return {type: "bigint", literal: this.literal}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "bigint" && (this.literal === undefined || this.literal === construct.value)
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly jsonSchema = makeSchema("bigint", {literal: z.bigint().optional()})
    static readonly fromJson = (json: SchemaJson): BigIntSchema =>
        new BigIntSchema(parseJson(json, BigIntSchema.jsonSchema).literal)
    static readonly intersectionRules = [
        selfRule(BigIntSchema, "bigint", (a, b) => {
            if (a.literal === undefined) return b
            if (b.literal === undefined) return a
            if (a.literal === b.literal) return a
            return NeverSchema.instance
        })
    ]
    static readonly equalityRules = [
        selfRule(BigIntSchema, "bigint", (a, b) => a.literal === b.literal)
    ]
}