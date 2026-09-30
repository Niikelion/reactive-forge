// Shared by generate.ts (building the final ComponentMetadata.props) and annotations/index.ts
// (which needs the same Record<string, PropMetadata> shape to call @reactive-forge/schema's
// resolvePath - section 2 resolves a SlotPath against exactly this shape, not against a live
// ObjectSchema instance). Pulled out to its own module so neither file has to import the other
// just for this one function (generate.ts already depends on annotations/index.ts for
// buildSlotAnnotations).

import { exampleValue } from "@reactive-forge/schema"
import { ComponentData } from "./types.js"
import { PropMetadata } from "./metadataTypes.js"

export function buildProps(component: ComponentData): Record<string, PropMetadata> {
    const props: Record<string, PropMetadata> = {}
    for (const [propName, propSchema] of Object.entries(component.args)) {
        const meta = component.propMeta[propName]
        const example = exampleValue(propSchema.schema)
        props[propName] = {
            schema: propSchema.schema.toJson(),
            required: propSchema.required,
            ...(meta?.provenance !== undefined ? { provenance: meta.provenance } : {}),
            ...(meta?.description !== undefined ? { description: meta.description } : {}),
            ...(meta?.defaultValue !== undefined ? { defaultValue: meta.defaultValue } : {}),
            ...(example !== undefined ? { exampleValue: example } : {}),
            diagnostics: meta?.diagnostics ?? []
        }
    }
    return props
}
