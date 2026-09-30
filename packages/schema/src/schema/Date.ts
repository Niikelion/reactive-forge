import {Schema, SchemaJson} from "@/schema/Schema";
import {c} from "@/schema/constructUtils";
import {ValueConstruct} from "@/schema/Construct";
import {AsJson, makeSchema, parseJson, selfRule} from "@/schema/utils";

export class DateSchema implements Schema {
    readonly name = "date"
    readonly exampleConstruct = c.date(new Date())

    toJson(): AsJson<typeof DateSchema> {
        return {type: "date"}
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "date" && Number.isFinite(Date.parse(construct.value))
    }

    withTransformedChildren(): Schema {
        return this
    }

    static readonly instance = new DateSchema()
    static readonly jsonSchema = makeSchema("date", {})
    static readonly fromJson = (json: SchemaJson): DateSchema => {
        void parseJson(json, DateSchema.jsonSchema)
        return DateSchema.instance
    }
    static readonly intersectionRules = [selfRule(DateSchema, "date", schema => schema)]
    static readonly equalityRules = [selfRule(DateSchema, "date", () => true)]
}
