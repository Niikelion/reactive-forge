import {createElement, useState} from "react"
import {ValueJson} from "@reactive-forge/schema"
import {ControlComponent} from "./types.js"
import {commitValue} from "./commit.js"
import {resolveInitialValueJson} from "./value.js"

/**
 * Generic default control for composite schema types (`array`, `object`)
 * that have no small, fixed set of primitive widgets: a textarea holding the
 * prop's raw `ValueJson` as pretty-printed JSON. This is a deliberately
 * blunt fallback, not a polished nested editor (a real per-element/
 * per-property array/object editor is out of scope for this gate's small
 * worked example) - a consumer with a concrete shape in mind should register
 * a real control for that specific prop/schema via the `controls` override
 * map (see registry.ts) rather than rely on this for production UI.
 *
 * Still goes through the same `commitValue` validation path as every other
 * control: malformed JSON or a value that doesn't satisfy the schema is
 * reported as an inline error and never committed.
 */
export const JsonControl: ControlComponent = (props) => {
    const {schema, onChange} = props
    const initial = resolveInitialValueJson(props)
    const [text, setText] = useState(() => JSON.stringify(initial ?? {type: schema.type}, null, 2))
    const [error, setError] = useState<string | undefined>(undefined)

    return createElement("div", {"data-control": schema.type}, [
        createElement("textarea", {
            key: "input",
            rows: 6,
            value: text,
            onChange: (event: {target: {value: string}}) => { setText(event.target.value) },
            onBlur: () => {
                try {
                    const parsed = JSON.parse(text) as ValueJson
                    const next = commitValue(schema, parsed)
                    setError(undefined)
                    onChange({kind: "composed", value: {kind: "leaf", value: next}})
                } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                }
            }
        }),
        error ? createElement("div", {key: "error", "data-error": "true"}, error) : null
    ])
}
