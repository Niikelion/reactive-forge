import {createElement} from "react"
import {ControlComponent} from "./types.js"

/**
 * Default control for function-typed props: a `<select>` of the currently
 * available names in the host-supplied `CallbackRegistry` (per the task's
 * explicit requirement - picking a named binding, never typing a function
 * body, consistent with the runtime's callback-reference-only model, see
 * `CompositionPropValue`'s `"callback"` variant). Produces a
 * `{kind: "callback", name}` slot value directly - there is no `ValueJson`
 * for a function, so this is the one control that never calls `commitValue`.
 */
export const FunctionControl: ControlComponent = ({currentValue, callbacks, onChange}) => {
    const names = Object.keys(callbacks ?? {})
    const current = currentValue?.kind === "callback" ? currentValue.name : ""

    return createElement("select", {
        "data-control": "function",
        value: current,
        onChange: (event: {target: {value: string}}) => {
            const name = event.target.value
            if (name === "") return
            onChange({kind: "callback", name})
        }
    }, [
        createElement("option", {key: "", value: ""}, "(none)"),
        ...names.map(name => createElement("option", {key: name, value: name}, name))
    ])
}
