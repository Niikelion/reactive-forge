import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {z} from "zod";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";
import {NeverSchema} from "@/schema/Never";

export class BooleanSchema implements Schema {
    readonly name = "boolean"
    readonly literal?: boolean
    readonly exampleConstruct: ValueConstruct

    constructor(literal?: boolean) {
        this.literal = literal
        this.exampleConstruct = c.boolean(literal ?? false)
    }

    toJson(): AsJson<typeof BooleanSchema> {
        return {type: "boolean", ...(this.literal !== undefined ? {literal: this.literal} : {})}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "boolean" && (this.literal === undefined || this.literal === construct.value)
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly jsonSchema = makeSchema("boolean", {literal: z.boolean().optional()})
    static readonly fromJson = (json: SchemaJson): BooleanSchema =>
        new BooleanSchema(parseJson(json, BooleanSchema.jsonSchema).literal)
    static readonly intersectionRules = [
        selfRule(BooleanSchema,"boolean", (a, b) => {
            if (a.literal === undefined) return b
            if (b.literal === undefined) return a
            if (a.literal === b.literal) return a
            return NeverSchema.instance
        })
    ]
    static readonly equalityRules = [
        selfRule(BooleanSchema,"boolean", (a, b) => a.literal === b.literal)
    ]
}