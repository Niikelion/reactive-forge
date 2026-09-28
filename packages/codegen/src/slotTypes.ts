// Slot-contract types (docs/slot-contract.md sections 1-5), re-exported from
// `@reactive-forge/schema`.
//
// History: this file started as local, contract-shaped type copies (the same pattern
// `packages/codegen/src/metadataTypes.ts` used for the v1 metadata contract, later swapped to a
// re-export once the schema package had the real types - see that file's own header comment for
// the precedent). By the time this worker's implementation was validated end-to-end, the schema/
// path-helpers worker had already landed real `PathSegment`/`SlotPath`/`SlotPolicy`/`SlotRule`/
// `EffectiveSlotRule`/`ComponentIdentity`/`ExternalComponentIdentity`/`ExternalLibraryRef` types
// in `packages/schema/src/schema/{SlotPath,SlotPolicy,ComponentIdentity,metadata}.ts`, matching
// this file's independently-derived shapes field-for-field (confirmed by direct comparison, see
// this worker's final report). This file was reduced to a re-export at that point, exactly per
// the metadataTypes.ts precedent - nothing in this package imports these types through any other
// path, so the swap was a one-file change.
//
// Only the pieces the contract does not assign to `@reactive-forge/schema` stay local:
// `ComponentMetadataSource`/`LibraryMetadataSource` (opaque authoring-API return types, needed so
// `defineComponentMetadata`/`defineLibraryMetadata` call sites typecheck - see slotAuthoring.ts),
// and `LibraryAnnotationSource`/`AnnotationSourcesConfig` (codegen's own config shape, section 5's
// "Annotation source discovery (config)", which extends `CodegenConfig` - a codegen-only type).

export type {
    VariantLiteral,
    PathSegment,
    SlotPath,
    AnyNodePolicy,
    ComponentsPolicy,
    RichTextMark,
    RichTextPolicy,
    ComponentRefPolicy,
    SlotPolicy,
    SlotRule,
    SlotLayer,
    EffectiveSlotRule
} from "@reactive-forge/schema"

export type {
    ComponentIdentity,
    ExternalComponentIdentity
} from "@reactive-forge/schema"

export type {
    ComponentMetadata,
    PropMetadata,
    Diagnostic,
    MetadataDocument,
    ExternalLibraryRef
} from "@reactive-forge/schema"

import type { SlotRule as SlotRuleType } from "@reactive-forge/schema"

// Opaque authoring-API return types. Codegen never inspects these at runtime (it statically
// analyzes the *call expression* that produces them, per section 5's "never imported/executed"
// rule) - they exist so `defineComponentMetadata`/`defineLibraryMetadata` call sites in fixture/
// project source typecheck. See slotAuthoring.ts.
export interface ComponentMetadataSource {
    rules: SlotRuleType[]
}

export interface LibraryMetadataSource {
    compatibleVersions: string
    components: ComponentMetadataSource[]
}

// docs/slot-contract.md section 5's "Annotation source discovery (config)" - codegen-owned config
// shapes, not part of the schema package's runtime-facing contract.
export interface LibraryAnnotationSource {
    package: string
    metadataModule: string
}

export interface AnnotationSourcesConfig {
    colocated?: boolean
    libraries?: LibraryAnnotationSource[]
    overrideSources?: string[]
}
