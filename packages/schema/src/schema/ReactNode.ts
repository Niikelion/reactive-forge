import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";

export class ReactNodeSchema implements Schema {
    readonly name = "reactNode"
    readonly exampleConstruct: ValueConstruct = c.null()

    toJson(): AsJson<typeof ReactNodeSchema> {
        return {type: "reactNode"}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "element"
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly jsonSchema = makeSchema("reactNode", {})
    static readonly fromJson = (json: SchemaJson): ReactNodeSchema => {
        void parseJson(json, ReactNodeSchema.jsonSchema)
        return ReactNodeSchema.instance
    }
    static readonly intersectionRules = [selfRule(ReactNodeSchema, "reactNode", schema => schema)]
    static readonly equalityRules = [selfRule(ReactNodeSchema, "reactNode", () => true)]
    static readonly instance = new ReactNodeSchema()
}