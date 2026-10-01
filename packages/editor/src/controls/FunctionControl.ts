import {createElement} from "react"
import {ControlComponent} from "./types.js"

/** Bind an explicitly declared function input; callback names are legacy-only. */
export const FunctionControl: ControlComponent = ({currentValue, callbacks, declaredProps, onChange}) => {
    const functionLike = (schema: {type: string, [key: string]: unknown}): boolean =>
        schema.type === "function" || (schema.type === "union" && Array.isArray(schema["types"]) &&
            schema["types"].some(member => typeof member === "object" && member !== null && "type" in member &&
                functionLike(member as {type: string, [key: string]: unknown})))
    const names = declaredProps !== undefined
        ? Object.entries(declaredProps).filter(([, prop]) => functionLike(prop.schema)).map(([name]) => name)
        : Object.keys(callbacks ?? {})
    const current = currentValue?.kind === "callback" || currentValue?.kind === "prop" ? currentValue.name : ""

    return createElement("select", {
        "data-control": "function",
        value: current,
        onChange: (event: {target: {value: string}}) => {
            const name = event.target.value
            if (name === "") return
            onChange({kind: declaredProps !== undefined ? "prop" : "callback", name})
        }
    }, [
        createElement("option", {key: "", value: ""}, "(none)"),
        ...names.map(name => createElement("option", {key: name, value: name}, name))
    ])
}
