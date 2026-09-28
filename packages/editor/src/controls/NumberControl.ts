import {createElement} from "react"
import {ControlComponent} from "./types.js"
import {commitValue} from "./commit.js"
import {resolveInitialValueJson} from "./value.js"

/** Default control for `number` props: a numeric input. */
export const NumberControl: ControlComponent = (props) => {
    const {schema, onChange} = props
    const value = resolveInitialValueJson(props)
    const current = value !== undefined && value.type === "number" ? value.value : 0
    return createElement("input", {
        type: "number",
        "data-control": "number",
        value: current,
        onChange: (event: {target: {value: string}}) => {
            const parsed = Number(event.target.value)
            if (Number.isNaN(parsed)) return
            const next = commitValue(schema, {type: "number", value: parsed})
            onChange({kind: "composed", value: {kind: "leaf", value: next}})
        }
    })
}
