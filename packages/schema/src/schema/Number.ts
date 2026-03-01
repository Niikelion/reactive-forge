import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {z} from "zod";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";
import {NeverSchema} from "@/schema/Never";

export class NumberSchema implements Schema {
    readonly name = "number"
    readonly literal?: number
    readonly exampleConstruct: ValueConstruct

    constructor(literal?: number) {
        this.literal = literal
        this.exampleConstruct = c.number(literal ?? 0)
    }

    toJson(): AsJson<typeof NumberSchema> {
        return {type: "number", literal: this.literal}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "number" && (this.literal === undefined || this.literal === construct.value)
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly jsonSchema = makeSchema("number", {literal: z.number().optional()})
    static readonly fromJson = (json: SchemaJson): NumberSchema =>
        new NumberSchema(parseJson(json, NumberSchema.jsonSchema).literal)
    static readonly intersectionRules = [
        selfRule(NumberSchema, "number", (a, b) => {
            if (a.literal === undefined) return b
            if (b.literal === undefined) return a
            if (a.literal === b.literal) return a
            return NeverSchema.instance
        }),
    ]
    static readonly equalityRules = [
        selfRule(NumberSchema, "number", (a, b) => a.literal === b.literal)
    ]
}