import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {TypeOf} from "zod";
import {makeSchema, parseJson, schemaFromJson, selfRule} from "@/schema/utils";
import {ArraySchema} from "@/schema/Array";
import {isAssignableTo} from "@/schema/assignability";
import {equals} from "@/schema/equality";

export class FunctionSchema implements Schema {
    readonly name = "function"
    readonly returnType: Schema
    readonly paramsType: ArraySchema
    readonly exampleConstruct: ValueConstruct

    constructor(returnType: Schema, paramsType: ArraySchema) {
        this.returnType = returnType
        this.paramsType = paramsType
        this.exampleConstruct = c.function(() => returnType.exampleConstruct, returnType, paramsType)
    }

    toJson(): TypeOf<typeof FunctionSchema.jsonSchema> {
        return {
            type: "function",
            returnType: this.returnType.toJson(),
            paramsType: this.paramsType.toJson()
        }
    }

    verifyConstructType(construct: ValueConstruct): boolean {
        return construct.type === "function"
            && isAssignableTo(construct.value.returnType, this.returnType)
            && isAssignableTo(this.paramsType, construct.value.returnType)
    }

    withTransformedChildren(transformer: (node: Schema) => Schema): FunctionSchema {
        return new FunctionSchema(transformer(this.returnType), this.paramsType.withTransformedChildren(transformer))
    }

    static readonly jsonSchema = makeSchema("function", {
        returnType: SchemaJson,
        paramsType: ArraySchema.jsonSchema
    })
    static readonly fromJson = (json: SchemaJson): FunctionSchema => {
        const parsedJson = parseJson(json, FunctionSchema.jsonSchema)
        return new FunctionSchema(
            schemaFromJson(parsedJson.returnType),
            ArraySchema.fromJson(parsedJson.paramsType)
        )
    }
    //TODO: implement, take overloads into account
    static readonly intersectionRules = []
    static readonly equalityRules = [
        selfRule(FunctionSchema, "function", (a, b) =>
            equals(a.returnType, b.returnType) && equals(b.paramsType, b.paramsType)
        )
    ]
}