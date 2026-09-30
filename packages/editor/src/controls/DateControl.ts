import {createElement} from "react"
import {ControlComponent} from "./types.js"
import {commitValue} from "./commit.js"
import {resolveInitialValueJson} from "./value.js"

/** Edit an instant explicitly in UTC, preserving seconds and milliseconds. */
export const DateControl: ControlComponent = (props) => {
    const {schema, onChange} = props
    const value = resolveInitialValueJson(props)
    const current = value !== undefined && value.type === "date" && Number.isFinite(Date.parse(value.value)) ? new Date(value.value).toISOString().slice(0, -1) : ""

    return createElement("input", {
        type: "datetime-local",
        step: "0.001",
        "aria-label": "Date and time (UTC)",
        "data-control": "date",
        value: current,
        onChange: (event: {target: {value: string}}) => {
            if (!event.target.value) return
            const date = new Date(`${event.target.value}Z`)
            if (!Number.isFinite(date.getTime())) return
            const iso = date.toISOString()
            const next = commitValue(schema, {type: "date", value: iso})
            onChange({kind: "composed", value: {kind: "leaf", value: next}})
        }
    })
}
