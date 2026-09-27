import type { FC } from "react"
import type { SchemaJson } from "./schema/Schema"

export interface ComponentEntry {
    // Stable component identity, matching `ComponentMetadata.id` in the portable
    // metadata document (docs/metadata-contract.md, "Stable component identity").
    // Computed by the same function (`componentId` in packages/codegen/src/hash.ts)
    // that computes metadata.json's id, so the two can never drift apart.
    id: string
    component: FC
    args: SchemaJson
}

export interface ComponentFileData {
    path: string
    components: Record<string, ComponentEntry>
}

export interface ComponentLibraryData {
    files: ComponentFileData[]
}

/**
 * Looks up a registry entry by its stable metadata `id`, the intended lookup key per
 * docs/metadata-contract.md's "Public import/export identity" ("Consumers import a component
 * from the generated registry by id, not by sourcePath/name directly"). Returns `undefined` when
 * no entry in the library carries that id.
 */
export function findComponentEntry(library: ComponentLibraryData, id: string): ComponentEntry | undefined {
    for (const file of library.files) {
        for (const entry of Object.values(file.components)) {
            if (entry.id === id) return entry
        }
    }
    return undefined
}
