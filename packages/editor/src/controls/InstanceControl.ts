import {createElement, ReactElement, useEffect, useState} from "react"
import {InstanceSchema, ObjectSchema, schemaFromJson, SchemaJson, ValueJson} from "@reactive-forge/schema"
import {urlFromData} from "@reactive-forge/runtime"
import {ControlComponent, ControlOverrides} from "./types.js"
import {pickControl} from "./registry.js"
import {resolveInitialValueJson} from "./value.js"
import {commitValue} from "./commit.js"

function PayloadFields({schema, value, controls, onChange}: {schema: SchemaJson, value?: ValueJson, controls?: ControlOverrides, onChange: (v: ValueJson) => void}): ReactElement {
    const parsed = schemaFromJson(schema)
    if (parsed instanceof ObjectSchema) {
        const fields = value?.type === "object" ? value.value : {}
        return createElement("fieldset", {}, Object.entries(parsed.properties).map(([key, property]) => createElement("label", {key}, [
            createElement("span", {key: "label"}, key),
            createElement(PayloadFields, {key: "value", schema: property.schema.toJson(), value: fields[key], controls,
                onChange: next => {onChange({type: "object", value: {...fields, [key]: next}})}})
        ])))
    }
    const Control = pickControl(schema.type, undefined, controls)
    return createElement(Control, {schema, controls, currentValue: value ? {kind: "composed", value: {kind: "leaf", value}} : undefined,
        onChange: next => {if (next.kind === "composed" && next.value.kind === "leaf") onChange(next.value.value)}})
}

export const InstanceControl: ControlComponent = props => {
    const initial = resolveInitialValueJson(props)
    const [payload, setPayload] = useState<ValueJson | undefined>(initial?.type === "instance" ? initial.value : undefined)
    const [error, setError] = useState<string>()
    useEffect(() => {
        setPayload(initial?.type === "instance" ? initial.value : undefined)
        setError(undefined)
    }, [initial])
    const schema = schemaFromJson(props.schema)
    if (!(schema instanceof InstanceSchema) || !schema.adapter || !schema.payloadSchema)
        return createElement("span", {"data-control": "instance", role: "status"}, "Configure a value adapter to edit this class")
    const adapter = schema.adapter
    return createElement("div", {"data-control": "instance"}, [
        createElement(PayloadFields, {key: "payload", schema: schema.payloadSchema.toJson(), value: payload, controls: props.controls,
            onChange: value => {
                setPayload(value)
                try {
                    if (adapter.id === "builtin/URL") urlFromData(value.type === "string" ? value.value : undefined)
                    const next = commitValue(props.schema, {type: "instance", adapterId: adapter.id, version: adapter.version, value})
                    setError(undefined)
                    props.onChange({kind: "composed", value: {kind: "leaf", value: next}})
                } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
            }}),
        error ? createElement("div", {key: "error", role: "alert"}, error) : null
    ])
}
