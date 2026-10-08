import type { FC } from "react"
import type { SchemaJson } from "./schema/Schema"
import type {ComponentGroup, GroupValueFactory} from "./schema/ComponentGroup"

export interface ComponentEntry {
    groups?: ComponentGroup[]
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

/**
 * A pure function the host lets composition expressions call (`{kind: "call"}` in
 * @reactive-forge/runtime). Rendering calls `implementation`; generated code imports the same
 * function from `module`. Reactive Forge knows nothing about what it does beyond its types.
 */
export interface FunctionEntry {
    implementation: (...args: never[]) => unknown
    /** Module specifier generated code imports it from. */
    module: string
    exportName: string
    isDefault?: boolean
    /** Parameter types, in order. */
    params: SchemaJson[]
    /** The type of every argument after `params`, for a variadic function. */
    rest?: SchemaJson
    returns: SchemaJson
}

export interface ComponentLibraryData {
    groupValueFactories?: GroupValueFactory[]
    componentGroups?: ComponentGroup[]
    valueAdapters?: import("./schema/Instance").ValueAdapterRegistry
    /** Functions composition expressions may call, by the name expressions use. */
    functions?: Record<string, FunctionEntry>
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
