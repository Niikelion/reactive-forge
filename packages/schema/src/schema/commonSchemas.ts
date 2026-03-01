import {SchemaFactory} from "@/schema/Schema"
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

export const commonTypes: Record<string, { fromJson: SchemaFactory }> = {
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