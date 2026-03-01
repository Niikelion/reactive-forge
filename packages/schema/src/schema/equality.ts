import { Schema } from "@/schema/Schema";
import {resolveWithRules, Rule, RuleFilter} from "@/schema/utils";

export type EqualityRule = Rule<boolean>

const equalityRuleRegistry = new Map<RuleFilter, EqualityRule>()

function getEqualityRule(name: RuleFilter): EqualityRule | null {
    return equalityRuleRegistry.get(name) ?? null
}

export function equals(a: Schema, b: Schema): boolean
export function equals(a: Schema | undefined, b: Schema | undefined): boolean
export function equals(a: Schema | undefined, b: Schema | undefined): boolean {
    if (!a || !b) return a === b

    const result = resolveWithRules(getEqualityRule, a, b)
    if (result === undefined) throw new Error("Could not compare")

    return result
}

export function registerEqualityRule(rule: EqualityRule) {
    if (equalityRuleRegistry.has(rule.filter)) throw new Error(`Cannot override equality rule ${rule.filter}`)
    equalityRuleRegistry.set(rule.filter, rule)
}