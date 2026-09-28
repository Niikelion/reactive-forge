// Plain types mirroring docs/slot-contract.md section 5 exactly. Identity resolution (hashing an
// external id, resolving .d.ts paths, discovering companion metadata packages) is codegen's job —
// this file only owns the shape, since `SlotPolicy`'s `accepts: ComponentIdentity[]` (SlotPolicy.ts)
// needs it and slot rules are addressed/merged here in packages/schema.

export interface ExternalComponentIdentity {
    source: "external"
    package: string
    subpath?: string
    exportName: string
    isDefault: boolean
}

export type ComponentIdentity =
    | { source: "project", id: string }
    | ExternalComponentIdentity

/** Structural equality of two `ComponentIdentity` values (used by `checkSlotValue`'s `accepts` check). */
export function componentIdentityEquals(a: ComponentIdentity, b: ComponentIdentity): boolean {
    if (a.source !== b.source) return false
    if (a.source === "project" && b.source === "project") return a.id === b.id
    if (a.source === "external" && b.source === "external") {
        return a.package === b.package
            && (a.subpath ?? undefined) === (b.subpath ?? undefined)
            && a.exportName === b.exportName
            && a.isDefault === b.isDefault
    }
    return false
}
