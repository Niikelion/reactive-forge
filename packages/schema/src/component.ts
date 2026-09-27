import type { FC } from "react"
import type { SchemaJson } from "./schema/Schema"

export interface ComponentEntry {
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
