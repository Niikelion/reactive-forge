import {Schema} from "@/schema/Schema";
import {resolveWithRules, Rule, RuleFilter} from "@/schema/utils";

export type IntersectionRule = Rule<Schema>

const intersectionRuleRegistry = new Map<RuleFilter, IntersectionRule>()

function getIntersectionRule(name: RuleFilter): IntersectionRule | null {
    return intersectionRuleRegistry.get(name) ?? null
}

export function intersect(first: Schema, second: Schema): Schema
export function intersect(first: Schema | undefined, second: Schema | undefined): Schema | undefined
export function intersect(first: Schema | undefined, second: Schema | undefined): Schema | undefined {
    if (!first || !second) return first ?? second

    const result = resolveWithRules(getIntersectionRule, first, second)
    if (!result) throw new Error("Could not calculate intersection")

    return result
}

export function registerIntersectionRule(rule: IntersectionRule) {
    if (intersectionRuleRegistry.has(rule.filter)) throw new Error(`Cannot override intersection rule ${rule.filter}`)
    intersectionRuleRegistry.set(rule.filter, rule)
}