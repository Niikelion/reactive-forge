import {ValueJson} from "@reactive-forge/schema"
import {ControlProps} from "./types.js"

/**
 * The value a control should show when it first renders: the composition
 * instance's current stored value if one has been set, otherwise the prop's
 * `defaultValue`, otherwise its `exampleValue` - never the other way around
 * (docs/metadata-contract.md, "Safe default metadata vs. example values": a
 * generated example must never be presented as though it were an actual
 * default). Returns `undefined` if none of the three are available (or the
 * slot currently holds a `"callback"` reference, which has no `ValueJson`).
 */
export function resolveInitialValueJson(props: ControlProps): ValueJson | undefined {
    if (props.currentValue?.kind === "composed" && props.currentValue.value.kind === "leaf") return props.currentValue.value.value
    return props.defaultValue ?? props.exampleValue
}
