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
        // bigint is not valid JSON; carry a literal (when present) as a decimal string, matching
        // ValueJson's "bigint" variant encoding.
        return {type: "bigint", ...(this.literal !== undefined ? {literal: this.literal.toString()} : {})}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "bigint" && (this.literal === undefined || this.literal === construct.value)
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly jsonSchema = makeSchema("bigint", {literal: z.string().optional()})
    static readonly fromJson = (json: SchemaJson): BigIntSchema => {
        const literal = parseJson(json, BigIntSchema.jsonSchema).literal
        return new BigIntSchema(literal !== undefined ? BigInt(literal) : undefined)
    }
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