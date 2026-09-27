import {FC} from "react"
import {CallbackRegistry} from "@reactive-forge/runtime"
import {DefaultValueJson, Json, SchemaJson, ValueJson} from "@reactive-forge/schema"

// Composition-document prop-value shape mirrors
// packages/runtime/src/composition.ts's CompositionPropValue - re-declared
// here (not imported) only to avoid a second import for a type this package
// already re-exports; keep in sync if that contract ever changes.
export type ControlPropValue =
    | { kind: "value", value: ValueJson }
    | { kind: "callback", name: string }

/**
 * The schema `type` tags a control can be registered against. Mirrors every
 * concrete `Schema.name` in packages/schema/src/schema/*.ts (verified against
 * `commonTypes` in commonSchemas.ts): "null" and "undefined"/"void"/"never"
 * are included even though most have no editable default control (see
 * `registry.ts`'s `defaultControls` for which ones do and why).
 */
export type SchemaTypeTag =
    | "string" | "number" | "boolean" | "bigint" | "date"
    | "array" | "object" | "union" | "reactNode" | "function"
    | "null" | "undefined" | "void" | "never" | "unknown"

/**
 * Props every prop control receives. Deliberately schema-first rather than
 * `PropMetadata`-first: nested controls (a union member, an array element)
 * need to render a control for a bare `SchemaJson` with no
 * default/example/description of their own, so those fields are optional
 * here and only populated by `PropControl` for the top-level, prop-level
 * control it resolves.
 */
export interface ControlProps {
    schema: SchemaJson
    /** The prop slot's current value, if any has been set on the composition instance. */
    currentValue: ControlPropValue | undefined
    /** Only meaningful at the top (prop) level - see docs/metadata-contract.md's default/example distinction. */
    defaultValue?: DefaultValueJson
    exampleValue?: ValueJson
    /** Additive editor-only hints (docs/metadata-contract.md "Optional editor hints"); never changes validity. */
    editorHints?: Record<string, Json>
    /** Names available to a function-typed prop's control (see FunctionControl). */
    callbacks?: CallbackRegistry
    /** Lets a composite control (union/array/object) resolve controls for nested schemas. */
    controls?: ControlOverrides
    onChange: (value: ControlPropValue) => void
}

export type ControlComponent = FC<ControlProps>

/**
 * The "replaceable control" surface (development-plan point 5): a plain map
 * a caller can partially override. Keys are either a bare `SchemaTypeTag`
 * (the default control for that schema type) or `"<tag>:<hint>"`, a *variant*
 * selected only when `editorHints.control === "<hint>"` on that prop (see
 * `pickControl` in registry.ts). Overriding one entry never requires
 * restating the rest - `{...defaultControls, "string:color-picker": MyControl}`
 * is a complete, valid override map.
 */
export type ControlOverrides = Partial<Record<string, ControlComponent>>
