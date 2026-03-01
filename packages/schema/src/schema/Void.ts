import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";

export class VoidSchema implements Schema {
    readonly name = "void"
    readonly exampleConstruct: ValueConstruct = c.void()

    toJson(): AsJson<typeof VoidSchema> {
        return {type: "void"}
    }

    verifyConstructType(): boolean {
        return false
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly jsonSchema = makeSchema("void", {})
    static readonly fromJson = (json: SchemaJson): VoidSchema => {
        void parseJson(json, VoidSchema.jsonSchema)
        return VoidSchema.instance
    }
    static readonly intersectionRules = [selfRule(VoidSchema, "void", schema => schema)]
    static readonly equalityRules = [selfRule(VoidSchema, "void", () => true)]
    static readonly instance = new VoidSchema()
}