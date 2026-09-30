import {createElement} from "react"
import type {ValueAdapter} from "@reactive-forge/schema"

export class Money {
    #amount: number
    constructor(amount: number, readonly currency: string) {
        if (!Number.isInteger(amount) || amount < 0) throw new Error("Amount must be nonnegative integer cents")
        this.#amount = amount
    }
    format() { return `${this.currency} ${String(this.#amount / 100)}` }
    get amount() { return this.#amount }
}
export function moneyFromData(data: unknown) {
    validateMoney(data)
    const value = data as {amount: number, currency: string}
    return new Money(value.amount, value.currency)
}
function validateMoney(data: unknown) {
    const value = data as {amount?: unknown, currency?: unknown} | null
    if (!value || typeof value.amount !== "number" || !Number.isInteger(value.amount) || value.amount < 0 || typeof value.currency !== "string") throw new Error("Invalid Money payload")
}
export const moneyAdapter: ValueAdapter = {
    id: "test/Money", version: 1,
    typeRef: {kind: "project", sourcePath: "tests/fixtures/class-values/values.ts", exportName: "Money"},
    fromData: moneyFromData, validateData: validateMoney,
    toData: value => {
        if (!(value instanceof Money)) throw new Error("Expected Money")
        return {amount: value.amount, currency: value.currency}
    },
    export: {module: "./values", exportName: "moneyFromData"}
}
export function Price(props: {money: Money, url: URL, at: Date}) {
    return createElement("span", {}, `${props.money.format()} ${props.url.hostname} ${props.at.toISOString()}`)
}
export function Collections(props: {prices: Map<string, Money>, tags: Set<string>, pattern: RegExp}) {
    return createElement("span", {}, `${props.prices.get("a")?.format()} ${[...props.tags].join(",")} ${props.pattern.source}/${props.pattern.flags}@${String(props.pattern.lastIndex)}`)
}
export class SpecialDate extends Date { special() { return true } }
export function Unsupported(props: {date: SpecialDate, constructorRef: typeof Money}) {
    return createElement("span", {}, String(props.date.special()) + props.constructorRef.name)
}
