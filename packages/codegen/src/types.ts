import {Symbol} from "ts-morph"
import {ObjectTypeSchema} from "@reactive-forge/shared";

export type ComponentData = {
    name: string
    symbol: Symbol
    isDefault: boolean
    args: ObjectTypeSchema["properties"]
}
