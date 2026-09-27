import {createElement} from "react"
import {ControlComponent} from "./types.js"

/**
 * Default control for schema types with nothing a form control could
 * meaningfully change:
 *
 * - `void`/`undefined`/`never`: no inhabited value to edit at all.
 * - `null`: exactly one valid value; there is nothing to *choose*, so this
 *   still counts as "not editable" even though the value itself is legal.
 * - `unknown`: accepts any `ValueJson`, but with no narrower schema a
 *   generic control can't offer a safe, meaningful default editing
 *   experience (unlike `array`/`object`, which at least know their own
 *   shape) - a consumer with a concrete idea of what "unknown" means for
 *   their props (e.g. a JSON textarea) can register one of their own via
 *   the `controls` override map without touching anything else.
 * - `reactNode`: a `ValueJson` "element" reference is out of scope for a
 *   default prop control - composing nested content belongs to the
 *   composition document's own `children` mechanism (`CompositionInstance.children`),
 *   not a per-prop value editor.
 *
 * Renders a small, inert label rather than crashing or doing nothing
 * silently, per the task's explicit requirement.
 */
export const NotEditableControl: ControlComponent = ({schema}) => {
    return createElement("span", {"data-editable": "false", "data-schema-type": schema.type}, `(${schema.type}: not editable)`)
}
