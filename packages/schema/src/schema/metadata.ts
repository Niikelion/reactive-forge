import {Json, SchemaJson} from "@/schema/Schema";
import {DefaultValueJson, ValueJson} from "@/schema/ValueJson";

// Plain types mirroring docs/metadata-contract.md exactly. This is the portable, JSON-safe
// document shape a compiler-coupled extractor (packages/codegen) produces and a
// compiler-independent reader (runtime/editor) consumes. Nothing here may reference ts-morph,
// TypeScript's `Symbol`/`Type`/`Node`, a `Schema` class instance, or a live `ValueConstruct`.

export interface Diagnostic {
    severity: "error" | "warning"
    code: string
    message: string
    location?: { sourcePath: string, line: number, column: number }
}

export interface PropMetadata {
    schema: SchemaJson
    required: boolean
    description?: string
    defaultValue?: DefaultValueJson
    exampleValue?: ValueJson
    editorHints?: Record<string, Json>
    diagnostics: Diagnostic[]
}

export interface ComponentMetadata {
    id: string
    name: string
    sourcePath: string
    isDefault: boolean
    description?: string
    props: Record<string, PropMetadata>
    diagnostics: Diagnostic[]
}

export interface MetadataDocument {
    schemaVersion: 1
    generatedAt: string
    components: ComponentMetadata[]
}

/**
 * Assembles a `MetadataDocument` from already-built `ComponentMetadata` entries. This is a thin
 * convenience only — it fixes `schemaVersion` at the current literal `1` and defaults
 * `generatedAt` to "now" so callers (the codegen worker) don't have to restate either per call
 * site. A plain object literal is equally valid; use whichever reads better at the call site.
 */
export function createMetadataDocument(components: ComponentMetadata[], generatedAt: string = new Date().toISOString()): MetadataDocument {
    return {schemaVersion: 1, generatedAt, components}
}
