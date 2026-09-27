import type { Symbol } from "ts-morph"
import type { ObjectSchema } from "@reactive-forge/schema"

export interface ComponentData {
    name: string
    symbol: Symbol
    isDefault: boolean
    args: ObjectSchema["properties"]
}

