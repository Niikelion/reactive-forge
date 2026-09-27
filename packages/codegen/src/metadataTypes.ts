// Portable metadata types defined in docs/metadata-contract.md, implemented
// in packages/schema (see packages/schema/src/schema/ValueJson.ts and
// metadata.ts). Re-exported here so callers in this package can keep
// importing from a stable local path.

export type {
    Json,
    ValueJson,
    DefaultValueJson,
    Diagnostic,
    ComponentMetadata,
    PropMetadata,
    MetadataDocument
} from "@reactive-forge/schema"
