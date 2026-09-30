import {createElement} from "react"
import {ControlComponent} from "./types.js"
import {commitValue} from "./commit.js"
import {resolveInitialValueJson} from "./value.js"

/**
 * Default control for `bigint` props: a text input parsed as a decimal
 * integer string (`ValueJson`'s bigint variant is carried as a string, since
 * real `bigint` is not valid JSON - see ValueJson.ts).
 */
export const BigIntControl: ControlComponent = (props) => {
    const {schema, onChange} = props
    const value = resolveInitialValueJson(props)
    const current = value !== undefined && value.type === "bigint" ? value.value : "0"

    return createElement("input", {
        type: "text",
        inputMode: "numeric",
        "data-control": "bigint",
        value: current,
        onChange: (event: {target: {value: string}}) => {
            const text = event.target.value.trim()
            if (!/^-?\d+$/.test(text)) return
            const next = commitValue(schema, {type: "bigint", value: text})
            onChange({kind: "composed", value: {kind: "leaf", value: next}})
        }
    })
}
