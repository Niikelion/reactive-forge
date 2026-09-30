import {createElement, useState} from "react"
import {exampleValue, fromValueJson, schemaFromJson, SchemaJson} from "@reactive-forge/schema"
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
    const matches = (member: SchemaJson): boolean => {
        if (currentValue?.kind === "callback") return member.type === "function"
        if (currentValue?.kind !== "composed" || currentValue.value.kind !== "leaf") return false
        try { fromValueJson(schemaFromJson(member), currentValue.value.value); return true } catch { return false }
    }
    const [selected, setSelected] = useState<string>(() => String(Math.max(0, members.findIndex(matches))))

    const activeMember = members[Number(selected)] ?? members[0]
    if (activeMember === undefined) return createElement("span", {}, "(empty union)")

    const Sub = pickControl(activeMember.type, editorHints, controls)
    const nestedCurrent =
        (currentLeafType === activeMember.type && matches(activeMember)) ||
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
        }, members.map((member, index) => createElement("option", {key: index, value: String(index)}, member.type === "instance" ? JSON.stringify(member["typeRef"]) : member.type))),
        createElement(Sub, {
            key: selected,
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
