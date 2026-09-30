# Prop presentation contract

The full props schema remains the runtime contract. Editor visibility never removes a prop or changes validation, callback handling, or slot restrictions.

## Defaults and precedence

1. Required inputs without declared source defaults are primary. Attempts to hide or demote them produce `required-editor-visibility` errors. Their containing objects, arrays, and union branches remain accessible.
2. Explicit annotations choose `primary`, `advanced`, or `hidden`. `auto` resets visibility to inference while preserving independently merged labels and groups.
3. Inference makes broadly inherited native React/DOM props advanced. Own declarations, redeclarations, shared component props, finite standard `Pick` selections, and unknown origins remain primary.

Project annotations override library/colocated annotations field by field. Conflicting assignments within one layer produce diagnostics; the first assignment to that field wins.

A source default exempts its prop subtree from the required-primary presentation rule. Example values and current composition values do not. Nested required fields under optional containers are primary when that container is edited; this does not require instantiating the optional container.

## Authoring

Use existing colocated or external metadata sources, with annotation sources enabled in codegen configuration:

```ts
defineComponentMetadata(Button, {
  rules: [
    {path: ["onClick"], editor: {visibility: "primary", group: "events", label: "On click"}},
    {path: ["title"], editor: {visibility: "advanced"}},
    {path: ["items", each(), "content"], editor: {label: "Item content"}},
  ],
})
```

Paths use the same property, `each()`, and `variant()` segments as slot annotations. A rule may contain both `editor` and `slot` fields. Static literal annotations are supported; dynamic expressions are diagnosed.

## Studio integration

```ts
import {registerCommonSchemas, resolveEditorPresentation} from "@reactive-forge/schema"

registerCommonSchemas()
const presentation = resolveEditorPresentation(componentMetadata, ["onClick"])
// visibility, group, label, source, reason, diagnostics
```

Render primary fields in the main inspector, advanced fields in its expandable section, and omit hidden fields. Use the existing schema to choose the actual control: making `onClick` primary still requires callback binding, not a text input.

Metadata stores declaration provenance on `props[name].provenance`, and authored presentation in `editorRules`, including per-field annotation sources. Editor-only rules never populate `slots`, preserving inferred ReactNode behavior. Legacy documents without these optional fields remain readable and default to primary presentation.

Provenance recognition is conservative: unsupported or unresolved types remain visible. This change supplies extraction and the shared resolver; Studio UI integration is separate.
