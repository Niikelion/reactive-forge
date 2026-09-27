import {createElement, FC} from "react"
import {PropMetadata} from "@reactive-forge/schema"
import {CallbackRegistry} from "@reactive-forge/runtime"
import {ControlComponent, ControlOverrides, ControlPropValue} from "./types.js"
import {NotEditableControl} from "./NotEditableControl.js"
import {NullControl} from "./NullControl.js"
import {StringControl} from "./StringControl.js"
import {NumberControl} from "./NumberControl.js"
import {BooleanControl} from "./BooleanControl.js"
import {BigIntControl} from "./BigIntControl.js"
import {DateControl} from "./DateControl.js"
import {JsonControl} from "./JsonControl.js"
import {FunctionControl} from "./FunctionControl.js"
import {UnionControl} from "./UnionControl.js"

/**
 * The built-in control for every schema `type` tag that has one. `array`/
 * `object` share the generic `JsonControl` fallback (see its doc comment);
 * `undefined`/`void`/`never`/`unknown`/`reactNode` are explicitly
 * non-editable by default (see `NotEditableControl`'s doc comment for why
 * each one is not a bug, but a scoping choice) - a consumer can still
 * register its own control for any of them via the `controls` override map,
 * nothing here is a hard limitation of the mechanism.
 */
export const defaultControls: ControlOverrides = {
    string: StringControl,
    number: NumberControl,
    boolean: BooleanControl,
    bigint: BigIntControl,
    date: DateControl,
    array: JsonControl,
    object: JsonControl,
    union: UnionControl,
    function: FunctionControl,
    null: NullControl,
    undefined: NotEditableControl,
    void: NotEditableControl,
    never: NotEditableControl,
    unknown: NotEditableControl,
    reactNode: NotEditableControl
}

/**
 * Resolves the control to render for a given schema `type` tag.
 *
 * Selection order:
 *  1. If `editorHints.control` is a string, look for a *variant* override
 *     keyed `"<schemaType>:<hint>"` - first in `overrides`, then in the
 *     built-in `defaultControls` (a variant may ship built-in, like a future
 *     `"string:color-picker"`, or be entirely consumer-supplied).
 *  2. Otherwise (or if no variant is registered), fall back to the bare
 *     `schemaType` key - first in `overrides`, then `defaultControls`.
 *  3. If nothing at all is registered, `NotEditableControl`.
 *
 * `editorHints` steers *which* control renders; it can never change what
 * value is accepted, since every control still commits through
 * `commitValue`/`fromValueJson` against the real schema (see commit.ts).
 */
export function pickControl(
    schemaType: string,
    editorHints: Record<string, unknown> | undefined,
    overrides: ControlOverrides = {}
): ControlComponent {
    const hint = editorHints && typeof editorHints["control"] === "string" ? editorHints["control"] : undefined
    const variantKey = hint !== undefined ? `${schemaType}:${hint}` : undefined
    const variant = variantKey !== undefined ? (overrides[variantKey] ?? defaultControls[variantKey]) : undefined
    return variant ?? overrides[schemaType] ?? defaultControls[schemaType] ?? NotEditableControl
}

export interface PropControlProps {
    propMeta: PropMetadata
    currentValue: ControlPropValue | undefined
    callbacks?: CallbackRegistry
    controls?: ControlOverrides
    onChange: (value: ControlPropValue) => void
}

/**
 * The top-level entry point: resolves and renders the control for one
 * component prop, given its full `PropMetadata` (so `defaultValue`/
 * `exampleValue`/`editorHints` are available - see `ControlProps`'s doc
 * comment on why nested/member controls only get a bare schema).
 */
export const PropControl: FC<PropControlProps> = ({propMeta, currentValue, callbacks, controls, onChange}) => {
    const Control = pickControl(propMeta.schema.type, propMeta.editorHints, controls)
    return createElement(Control, {
        schema: propMeta.schema,
        currentValue,
        defaultValue: propMeta.defaultValue,
        exampleValue: propMeta.exampleValue,
        editorHints: propMeta.editorHints,
        callbacks,
        controls,
        onChange
    })
}
