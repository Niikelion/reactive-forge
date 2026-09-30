import type {ComponentType} from "react"
import {ComponentEntry, ComponentGroup, ComponentLibraryData, findComponentEntry, GroupValueFactory, MetadataDocument, SchemaJson} from "@reactive-forge/schema"
import type {CompositionInstance} from "./composition.js"
import {validateComposition} from "./validate.js"
import {CompositionValidationError} from "./render.js"

/** Membership is explicit host registration, never supplied by a composition. */
export function registerComponent<P extends object>(component: ComponentType<P>, options: {id: string, args: SchemaJson, groups?: ComponentGroup[]}): ComponentEntry {
    if (!options.id.trim()) throw new Error("A registered component needs a stable id")
    return {...options, component: component as ComponentEntry["component"], groups: options.groups?.map(group => ({...group}))}
}

/** The host owns input interpretation and creates fresh instance/item identities. */
export function defineGroupValueFactory<Input>(group: ComponentGroup, create: (input: Input) => CompositionInstance): GroupValueFactory & {create: (input: Input) => CompositionInstance} {
    return {group, create} as GroupValueFactory & {create: (input: Input) => CompositionInstance}
}

function isInstance(value: unknown): value is CompositionInstance {
    return value !== null && typeof value === "object" && "kind" in value && value.kind === "instance" &&
        "componentId" in value && typeof value.componentId === "string" &&
        "instanceId" in value && typeof value.instanceId === "string" && value.instanceId.trim().length > 0 &&
        "props" in value && value.props !== null && typeof value.props === "object" && !Array.isArray(value.props)
}

/** Resolve exactly one host default, validate it, and store the concrete implementation. */
export function createGroupValue(group: ComponentGroup, input: unknown, library: ComponentLibraryData, metadata: MetadataDocument): CompositionInstance {
    const factories = library.groupValueFactories?.filter(factory => factory.group.id === group.id) ?? []
    if (factories.length !== 1) throw new Error(`Group "${group.id}" requires exactly one default value factory; found ${String(factories.length)}`)
    const factory = factories[0]
    if (factory === undefined) throw new Error(`Missing value factory for "${group.id}"`)
    const instance = factory.create(input)
    if (!isInstance(instance))
        throw new Error(`Factory for "${group.id}" must return an ordinary composition instance with a fresh identity`)
    const entry = findComponentEntry(library, instance.componentId)
    if (!entry?.groups?.some(member => member.id === group.id)) throw new Error(`Factory component "${instance.componentId}" is not registered in group "${group.id}"`)
    const result = validateComposition({schemaVersion: 4, root: instance}, metadata, library)
    if (!result.valid) throw new CompositionValidationError(result.diagnostics)
    return instance
}
