import {Symbol} from "ts-morph"
import {ValueTypeSchema} from "@reactive-forge/shared";

export type ComponentData = {
    name: string
    symbol: Symbol
    isDefault: boolean
    args: Record<string, ValueTypeSchema>
}
