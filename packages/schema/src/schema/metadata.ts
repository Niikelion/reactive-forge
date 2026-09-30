import {Json, SchemaJson} from "@/schema/Schema";
import {DefaultValueJson, ValueJson} from "@/schema/ValueJson";
import {EffectiveSlotRule} from "@/schema/SlotPolicy";
import {ExternalComponentIdentity} from "@/schema/ComponentIdentity";
import type {EditorRule, PropProvenance} from "@/schema/EditorPresentation";

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
    provenance?: PropProvenance
    schema: SchemaJson
    required: boolean
    description?: string
    defaultValue?: DefaultValueJson
    exampleValue?: ValueJson
    editorHints?: Record<string, Json>
    diagnostics: Diagnostic[]
}

export interface ComponentMetadata {
    editorRules?: EditorRule[]
    id: string
    name: string
    sourcePath: string
    isDefault: boolean
    description?: string
    props: Record<string, PropMetadata>
    diagnostics: Diagnostic[]
    // v2 only, additive (docs/slot-contract.md section 1). The fully merged, precedence-resolved
    // set of slot rules for this component. Empty array (never omitted) when the component has no
    // slot annotations at all and schemaVersion is 2; absent entirely on a v1-shaped
    // ComponentMetadata object literal (existing v1 construction sites are unaffected).
    slots?: EffectiveSlotRule[]
    // v2 only. Present iff this component's identity is external (slot-contract section 5).
    external?: ExternalComponentIdentity
}

// docs/slot-contract.md section 1. A public package specifier + the companion metadata package's
// declared compatible version range, plus the version actually resolved from node_modules and any
// diagnostics from that resolution — codegen's output, read-only data here.
export interface ExternalLibraryRef {
    package: string
    compatibleVersions: string
    resolvedVersion?: string
    diagnostics: Diagnostic[]
}

export interface MetadataDocument {
    schemaVersion: 1 | 2 | 3
    generatedAt: string
    components: ComponentMetadata[]
    // v2 only. Present iff any component's slots reference an external identity. Empty array,
    // never omitted, once schemaVersion is 2.
    externalLibraries?: ExternalLibraryRef[]
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

// v1 shape, exactly as metadata-contract.md froze it — used only as migrateMetadataDocumentV1ToV2's
// input type, so the migration's signature documents precisely what it accepts (a document whose
// components carry no v2-only fields at all).
export interface MetadataDocumentV1 {
    schemaVersion: 1
    generatedAt: string
    components: Omit<ComponentMetadata, "slots" | "external">[]
}

export interface MetadataDocumentV2 extends MetadataDocument {
    schemaVersion: 2
}

/**
 * v1 -> v2 metadata document upgrade, docs/slot-contract.md section 10. Total and lossless: every
 * field v2 adds is purely additive with an unambiguous empty/absent value for a document that
 * predates them, so this never throws and never emits a diagnostic.
 */
export function migrateMetadataDocumentV1ToV2(doc: MetadataDocumentV1): MetadataDocumentV2 {
    return {
        schemaVersion: 2,
        generatedAt: doc.generatedAt,
        components: doc.components.map(c => ({...c, slots: []})),
    }
}
