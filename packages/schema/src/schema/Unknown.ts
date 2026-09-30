import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {makeSchema, parseJson, rule, selfRule} from "@/schema/utils";
import {TypeOf} from "zod";

export class UnknownSchema implements Schema {
    readonly name = "unknown"
    readonly exampleConstruct: ValueConstruct = c.undefined()

    toJson(): TypeOf<typeof UnknownSchema.jsonSchema> {
        return {type: "unknown"}
    }

    verifyConstructType(): boolean {
        return true
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly jsonSchema = makeSchema("unknown", {})
    static readonly fromJson = (json: SchemaJson): UnknownSchema => {
        void parseJson(json, UnknownSchema.jsonSchema)
        return new UnknownSchema()
    }
    static readonly intersectionRules = [rule("&unknown", schema => schema, 0)]
    static readonly equalityRules = [selfRule(UnknownSchema, "unknown", () => true)]
}