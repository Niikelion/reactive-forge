import {createElement, useState} from "react"
import {exampleValue, schemaFromJson, SchemaJson} from "@reactive-forge/schema"
import {ControlComponent} from "./types.js"
import {pickControl} from "./registry.js"

function isSchemaJson(value: unknown): value is SchemaJson {
    return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as {type?: unknown}).type === "string"
}

function memberSchemas(schema: SchemaJson): SchemaJson[] {
    const types = schema["types"]
    if (!Array.isArray(types)) return []
    return types.filter(isSchemaJson)
}

/**
 * Default control for `union` props: a `<select>` choosing which member type
 * is active, delegating to that member's own control (resolved recursively
 * through the same `pickControl`/override mechanism as everything else - a
 * union member can itself be overridden, e.g. `"string:color-picker"` still
 * applies to a `string` member nested inside a union).
 */
export const UnionControl: ControlComponent = (props) => {
    const {schema, currentValue, editorHints, callbacks, controls, onChange} = props
    const members = memberSchemas(schema)
    const currentLeafType = currentValue?.kind === "composed" && currentValue.value.kind === "leaf"
        ? currentValue.value.value.type
        : undefined
    const currentTag = currentLeafType ?? (currentValue?.kind === "callback" ? "function" : undefined)
    const [selected, setSelected] = useState<string>(currentTag ?? members[0]?.type ?? "unknown")

    const activeMember = members.find(m => m.type === selected) ?? members[0]
    if (activeMember === undefined) return createElement("span", {}, "(empty union)")

    const Sub = pickControl(activeMember.type, editorHints, controls)
    const nestedCurrent =
        (currentLeafType === activeMember.type) ||
        (currentValue?.kind === "callback" && activeMember.type === "function")
            ? currentValue
            : undefined

    let example
    try { example = exampleValue(schemaFromJson(activeMember)) } catch { example = undefined }

    return createElement("div", {"data-control": "union"}, [
        createElement("select", {
            key: "select",
            "data-role": "union-variant",
            value: selected,
            onChange: (event: {target: {value: string}}) => { setSelected(event.target.value) }
        }, members.map(member => createElement("option", {key: member.type, value: member.type}, member.type))),
        createElement(Sub, {
            key: "value",
            schema: activeMember,
            currentValue: nestedCurrent,
            exampleValue: example,
            editorHints,
            callbacks,
            controls,
            onChange
        })
    ])
}
