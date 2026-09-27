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
