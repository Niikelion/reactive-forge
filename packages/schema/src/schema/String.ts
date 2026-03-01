import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {z} from "zod";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";
import {NeverSchema} from "@/schema/Never";

export class StringSchema implements Schema {
    readonly name = "string"
    readonly literal?: string
    readonly exampleConstruct: ValueConstruct

    constructor(literal?: string) {
        this.literal = literal
        this.exampleConstruct = c.string(literal ?? "")
    }

    toJson(): AsJson<typeof StringSchema> {
        return {type: "string", literal: this.literal}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "string" && (this.literal === undefined || this.literal === construct.value)
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly jsonSchema = makeSchema("string", {literal: z.string().optional()})
    static readonly fromJson = (json: SchemaJson): StringSchema =>
        new StringSchema(parseJson(json, StringSchema.jsonSchema).literal)
    static readonly intersectionRules = [
        selfRule(StringSchema, "string", (a, b) => {
            if (a.literal === undefined) return b
            if (b.literal === undefined) return a
            if (a.literal === b.literal) return a
            return NeverSchema.instance
        }),
    ]
    static readonly equalityRules = [
        selfRule(StringSchema, "string", (a, b) => a.literal === b.literal)
    ]
}