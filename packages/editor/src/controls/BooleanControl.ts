import {createElement} from "react"
import {ControlComponent} from "./types.js"
import {commitValue} from "./commit.js"
import {resolveInitialValueJson} from "./value.js"

/** Default control for `boolean` props: a checkbox. */
export const BooleanControl: ControlComponent = (props) => {
    const {schema, onChange} = props
    const value = resolveInitialValueJson(props)
    const current = value !== undefined && value.type === "boolean" && value.value

    return createElement("input", {
        type: "checkbox",
        "data-control": "boolean",
        checked: current,
        onChange: (event: {target: {checked: boolean}}) => {
            const next = commitValue(schema, {type: "boolean", value: event.target.checked})
            onChange({kind: "value", value: next})
        }
    })
}
