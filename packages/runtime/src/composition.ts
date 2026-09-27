import type {ValueJson} from "@reactive-forge/schema"

// Composition document contract (gate D, part 1 - see docs/claude-handoff.md
// section D and docs/development-plan.md point 4). JSON-serializable: a
// CompositionDocument round-trips through JSON.stringify/JSON.parse with no
// loss (proved by tests/runtime.test.cjs). It describes a tree of component
// instances - which registered component (`id`, matching both
// ComponentMetadata.id in a MetadataDocument and ComponentEntry.id in a
// loaded ComponentLibraryData), what prop values, and nested children.
//
// This is deliberately minimal: enough to round-trip through save/reload and
// render nested composition, not a general document/editor model. It is not
// part of docs/metadata-contract.md - that contract explicitly scopes the
// composition/runtime-document format to this gate (see its "Callbacks/
// functions" section).

/**
 * A single prop value slot on a composition instance. Two distinct kinds:
 *
 * - `"value"`: an ordinary, JSON-safe `ValueJson` (see
 *   packages/schema/src/schema/ValueJson.ts), validated against the
 *   component's declared prop schema. This is the same encoding
 *   metadata.json's `defaultValue`/`exampleValue` use - primitives, dates,
 *   arrays/objects, and single nested-component references via
 *   `ValueJson`'s `"element"` variant (resolved through the metadata
 *   document's `sourcePath`/`name`, then the registry, at render time).
 * - `"callback"`: a *named reference* into a host-supplied callback
 *   registry, never a serialized function body (development-plan point 4:
 *   "Persist callback references, not function bodies"). Only valid for a
 *   prop whose schema is function-typed (`FunctionSchema`). Resolved at
 *   render time against `RenderOptions.callbacks`; a name absent from that
 *   registry is a validation error (see validate.ts), never a silent no-op.
 */
export type CompositionPropValue =
    | { kind: "value", value: ValueJson }
    | { kind: "callback", name: string }

/**
 * One node in a composition's `children` array. Mirrors what
 * `ReactNodeSchema`/a `children` prop already supports: another component
 * instance, literal text, or nothing (void/null).
 */
export type CompositionNode = CompositionInstance | CompositionText | CompositionVoid

export interface CompositionInstance {
    kind: "instance"
    // Stable component id - looked up in both the MetadataDocument (for
    // schema/validation) and the ComponentLibraryData (for the actual FC),
    // see packages/schema/src/component.ts's findComponentEntry.
    id: string
    // Keyed by prop name, mirroring ComponentMetadata.props. A prop absent
    // from this map is "not provided" (must be optional, or validation
    // fails). The special prop name "children" is never used here - nested
    // children are expressed via the sibling `children` field below, not as
    // a prop value, even though the underlying component prop is also named
    // "children".
    props: Record<string, CompositionPropValue>
    children?: CompositionNode[]
}

export interface CompositionText {
    kind: "text"
    value: string
}

export interface CompositionVoid {
    kind: "void"
}

export interface CompositionDocument {
    schemaVersion: 1
    root: CompositionInstance
}
