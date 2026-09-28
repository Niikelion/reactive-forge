import {createElement} from "react"
import {ControlComponent} from "./types.js"
import {commitValue} from "./commit.js"
import {resolveInitialValueJson} from "./value.js"

/** Default control for `date` props: a native date input (ISO string value/output). */
export const DateControl: ControlComponent = (props) => {
    const {schema, onChange} = props
    const value = resolveInitialValueJson(props)
    const current = value !== undefined && value.type === "date" ? value.value.slice(0, 10) : ""

    return createElement("input", {
        type: "date",
        "data-control": "date",
        value: current,
        onChange: (event: {target: {value: string}}) => {
            if (!event.target.value) return
            const iso = new Date(event.target.value).toISOString()
            const next = commitValue(schema, {type: "date", value: iso})
            onChange({kind: "composed", value: {kind: "leaf", value: next}})
        }
    })
}
