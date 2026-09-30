import type { Symbol } from "ts-morph"
import type { ObjectSchema } from "@reactive-forge/schema"
import type { Diagnostic, DefaultValueJson } from "./metadataTypes.js"
import type { PropProvenance } from "./propProvenance.js"

// Extraction results for a single prop that extend beyond its Schema/required
// pair (which lives in ComponentData["args"], unchanged, since generate.ts's
// wrapper codegen consumes that shape directly). Kept separate rather than
// folded into `args` so `args` stays exactly `ObjectSchema["properties"]`.
export interface PropExtra {
    provenance?: PropProvenance
    description?: string
    defaultValue?: DefaultValueJson
    diagnostics: Diagnostic[]
}

export interface ComponentData {
    name: string
    sourcePath: string
    symbol: Symbol
    isDefault: boolean
    args: ObjectSchema["properties"]
    description?: string
    propMeta: Record<string, PropExtra>
    // Component-level diagnostics, e.g. a whole props type that could not be
    // represented, or a required prop whose type was unsupported.
    diagnostics: Diagnostic[]
}
