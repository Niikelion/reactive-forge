import {z, objectUtil, ZodLiteral, ZodObject, ZodType, TypeOf} from "zod";
import {getSchemaFactory, Schema, SchemaJson} from "@/schema/Schema";

type ZodProps = Record<string, ZodType>
type TypedZodSchema<T extends string, P extends ZodProps> = ZodObject<objectUtil.extendShape<{
    type: ZodLiteral<T>
}, P>>

export function makeSchema<T extends string, P extends ZodProps>(type: T, properties: P): TypedZodSchema<T, P> {
    return z.object({type: z.literal(type)}).extend(properties)
}

export function parseJson<T>(json: SchemaJson, schema: ZodType<T>): T {
    const parsedJson = schema.safeParse(json)
    //TODO: better errors
    if (!parsedJson.success) throw new Error()
    return parsedJson.data
}

export function schemaFromJson(json: SchemaJson): Schema {
    return getSchemaFactory(json.type, true)(json)
}

export type AsJson<T extends { jsonSchema: ZodType }> = TypeOf<T["jsonSchema"]>

export type RuleFilter = `${string}&${string}`
export type RuleHandler<T> = (a: Schema, b: Schema) => T
export interface Rule<T> {
    filter: RuleFilter
    handler: RuleHandler<T>
    order: number
}
export type RuleGetter<T> = (filter: RuleFilter) => Rule<T> | null

export function rule<T>(filter: RuleFilter, handler: RuleHandler<T>, order = 1): Rule<T> {
    return {
        filter,
        handler,
        order
    }
}

export function selfRule<T extends Schema, R>(type: new (...args: never[]) => T, name: T["name"], handler: (a: T, b: T) => R, order = 1): Rule<R> {
    return rule(`${name}&${name}`, (a, b) => {
        if (!(a instanceof type) || !(b instanceof type)) throw new Error(`Wrong name ${name} used in the rule`)
        return handler(a, b)
    }, order)
}

export function applyRule<T>(rule: Rule<T>, a: Schema, b: Schema): T {
    if (rule.filter.startsWith(b.name) || rule.filter.endsWith(a.name))
        return rule.handler(b, a)
    return rule.handler(a, b)
}

export function resolveWithRules<T>(getRule: RuleGetter<T>, a: Schema, b: Schema): T | undefined {
    const ruleGroups: RuleFilter[][] = [
        [`${a.name}&${b.name}`, `${b.name}&${a.name}`],
        [`${a.name}&`, `&${a.name}`, `${b.name}&`, `&${b.name}`],
        [`&`]
    ]

    const applicableRules = ruleGroups.flatMap(
        group => group
            .map(getRule)
            .filter(r => r !== null)
            .toSorted((a, b) => a.order - b.order)
    )

    const rule = applicableRules[0]

    if (!rule) return undefined
    return applyRule(rule, a, b)
}