import {Schema, SchemaJson} from "@/schema/Schema";
import {c} from "@/schema/constructUtils";
import {ValueConstruct} from "@/schema/Construct";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";

export class UndefinedSchema implements Schema {
    readonly name = "undefined"
    readonly exampleConstruct = c.undefined()

    toJson(): AsJson<typeof UndefinedSchema> {
        return {type: "undefined"}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "undefined"
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly instance = new UndefinedSchema()
    static readonly jsonSchema = makeSchema("undefined", {})
    static readonly fromJson = (json: SchemaJson): UndefinedSchema => {
        void parseJson(json, UndefinedSchema.jsonSchema)
        return UndefinedSchema.instance
    }
    static readonly intersectionRules = [selfRule(UndefinedSchema, "undefined", schema => schema)]
    static readonly equalityRules = [selfRule(UndefinedSchema, "undefined", () => true)]
}