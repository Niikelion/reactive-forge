import {registerSchemaFactory, SchemaFactory} from "@/schema/Schema"
import {IntersectionRule, registerIntersectionRule} from "@/schema/intersection";
import {EqualityRule, registerEqualityRule} from "@/schema/equality";
import {NeverSchema} from "@/schema/Never";
import {UnknownSchema} from "@/schema/Unknown";
import {NullSchema} from "@/schema/Null";
import {UndefinedSchema} from "@/schema/Undefined";
import {BooleanSchema} from "@/schema/Boolean";
import {NumberSchema} from "@/schema/Number";
import {BigIntSchema} from "@/schema/BigInt";
import {StringSchema} from "@/schema/String";
import {DateSchema} from "@/schema/Date";
import {ArraySchema} from "@/schema/Array";
import {ObjectSchema} from "@/schema/Object";
import {ReactNodeSchema} from "@/schema/ReactNode";
import {VoidSchema} from "@/schema/Void";
import {UnionSchema} from "@/schema/Union";
import {FunctionSchema} from "@/schema/Function";

interface SchemaModule {
    fromJson: SchemaFactory
    intersectionRules: IntersectionRule[]
    equalityRules: EqualityRule[]
}

export const commonTypes: Record<string, SchemaModule> = {
    never: NeverSchema,
    unknown: UnknownSchema,
    null: NullSchema,
    undefined: UndefinedSchema,
    boolean: BooleanSchema,
    number: NumberSchema,
    bigint: BigIntSchema,
    string: StringSchema,
    date: DateSchema,
    array: ArraySchema,
    object: ObjectSchema,
    reactNode: ReactNodeSchema,
    union: UnionSchema,
    void: VoidSchema,
    function: FunctionSchema,
}

export function registerCommonSchemas() {
    for (const [name, module] of Object.entries(commonTypes)) {
        registerSchemaFactory(name, module.fromJson)
        for (const rule of module.intersectionRules) registerIntersectionRule(rule)
        for (const rule of module.equalityRules) registerEqualityRule(rule)
    }
}