import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {AsJson, makeSchema, parseJson, rule, selfRule} from "@/schema/utils";

export class NeverSchema implements Schema {
    readonly name = "never"

    get exampleConstruct(): ValueConstruct {
        throw new Error("Cannot get the value construct of never")
    }

    toJson(): AsJson<typeof NeverSchema> {
        return {type: "never"}
    }

    verifyConstructType(): boolean {
        return false
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly instance = new NeverSchema()
    static readonly jsonSchema = makeSchema("never", {})
    static readonly fromJson = (json: SchemaJson): NeverSchema => {
        void parseJson(json, NeverSchema.jsonSchema)
        return NeverSchema.instance
    }
    static readonly intersectionRules = [
        rule("never&", () => NeverSchema.instance, 0),
        rule("&", () => NeverSchema.instance, -1)
    ]
    static readonly equalityRules = [selfRule(NeverSchema, "never", () => true)]
}