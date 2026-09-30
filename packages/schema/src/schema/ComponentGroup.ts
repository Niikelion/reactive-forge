import type {ComponentIdentity} from "./ComponentIdentity"

/** A portable identity for an explicitly registered group of components. */
export interface ComponentGroup {
    kind: "group"
    id: string
}

export type SlotAcceptance = ComponentIdentity | ComponentGroup

/** Host-owned factory; runtime validates that its result is a registered component instance. */
export interface GroupValueFactory {
    group: ComponentGroup
    create: (input: unknown) => unknown
}

export function defineComponentGroup(id: string): ComponentGroup {
    if (!/^[^\s/]+(?:\/[^\s/]+)+$/.test(id))
        throw new Error("Component group IDs must be namespaced, nonempty, and contain no whitespace")
    return Object.freeze({kind: "group", id})
}

export const Text = defineComponentGroup("forge/Text")
export const RichText = defineComponentGroup("forge/RichText")

export function isComponentGroup(value: SlotAcceptance): value is ComponentGroup {
    return "kind" in value
}
