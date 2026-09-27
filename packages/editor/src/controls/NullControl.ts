import {createElement} from "react"
import {ControlComponent} from "./types.js"

/**
 * `null` has exactly one legal value, so there is nothing to *choose* - this
 * renders the fixed value rather than a form input, distinct from
 * `NotEditableControl` only in that it still shows the (single, already
 * correct) value instead of a generic "not editable" placeholder.
 */
export const NullControl: ControlComponent = () => {
    return createElement("span", {"data-control": "null"}, "null")
}
