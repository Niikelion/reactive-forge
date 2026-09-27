import {createElement} from "react"
import {ControlComponent} from "./types.js"
import {commitValue} from "./commit.js"
import {resolveInitialValueJson} from "./value.js"

function currentText(props: Parameters<ControlComponent>[0]): string {
    const value = resolveInitialValueJson(props)
    return value !== undefined && value.type === "string" ? value.value : ""
}

/** Default control for `string` props: a plain text input. */
export const StringControl: ControlComponent = (props) => {
    const {schema, onChange} = props
    return createElement("input", {
        type: "text",
        "data-control": "string",
        value: currentText(props),
        onChange: (event: {target: {value: string}}) => {
            const next = commitValue(schema, {type: "string", value: event.target.value})
            onChange({kind: "value", value: next})
        }
    })
}

/**
 * Example "replaceable control" variant: picked instead of `StringControl`
 * only when a prop's `editorHints.control === "color-picker"` (see
 * `registry.ts`'s `pickControl`). Still a `string` schema underneath -
 * `editorHints` only steers *which widget* is shown, never what values are
 * valid (the commit path is identical to `StringControl`'s).
 */
export const ColorPickerStringControl: ControlComponent = (props) => {
    const {schema, onChange} = props
    const value = currentText(props) || "#000000"
    return createElement("input", {
        type: "color",
        "data-control": "string:color-picker",
        value,
        onChange: (event: {target: {value: string}}) => {
            const next = commitValue(schema, {type: "string", value: event.target.value})
            onChange({kind: "value", value: next})
        }
    })
}
