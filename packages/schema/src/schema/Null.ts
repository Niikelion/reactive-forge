import {Schema, SchemaJson} from "@/schema/Schema";
import {c} from "@/schema/constructUtils";
import {ValueConstruct} from "@/schema/Construct";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";

export class NullSchema implements Schema {
    readonly name = "null"
    readonly exampleConstruct = c.null()

    toJson(): AsJson<typeof NullSchema> {
        return {type: "null"}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "null"
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly instance = new NullSchema()
    static readonly jsonSchema = makeSchema("null", {})
    static readonly fromJson = (json: SchemaJson): NullSchema => {
        void parseJson(json, NullSchema.jsonSchema)
        return NullSchema.instance
    }
    static readonly intersectionRules = [selfRule(NullSchema, "null", schema => schema)]
    static readonly equalityRules = [selfRule(NullSchema, "null", () => true)]
}