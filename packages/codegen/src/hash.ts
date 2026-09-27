import path from "path"

// Deterministic, dependency-free string hash used for stable component
// identity (see docs/metadata-contract.md, "Stable component identity").
// FNV-1a 32-bit, hex-encoded. Not cryptographic; only needs to be stable
// across runs and unlikely to collide for the small input space of
// "<relativeSourcePath>\u0000<name>" strings this project produces.
export function shortHash(input: string): string {
    let hash = 0x811c9dc5

    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }

    return (hash >>> 0).toString(16).padStart(8, "0")
}

// POSIX-relative source path, anchored the same way for both the generated
// registry (generate.ts's componentEntries) and metadata.json
// (buildMetadataDocument) - see componentId below.
export function relativeSourcePath(rootDir: string, sourcePath: string): string {
    return path.relative(path.resolve(rootDir), path.resolve(sourcePath)).replace(/\\/g, "/")
}

// The single place `id` is computed for a component. Both the generated
// registry (ComponentEntry.id) and metadata.json (ComponentMetadata.id) call
// this exact function so the two ids can never drift apart - see
// docs/metadata-contract.md, "Stable component identity", and
// docs/baseline.md's "Known gap" callout this closes.
export function componentId(rootDir: string, sourcePath: string, name: string): string {
    return shortHash(`${relativeSourcePath(rootDir, sourcePath)}\u0000${name}`)
}
