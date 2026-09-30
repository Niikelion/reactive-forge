# Changelog

## 2.0.1

- Replace dedicated rich-text slots with generic component groups, including `forge/Text` and `forge/RichText`.
- Support explicit host registrations and validated host-owned value factories.
- Extract colocated and external group annotations, with project overrides and static resolution.
- Enforce restrictions in nested object, array and union slots; provide custom component editors.
- Remove the fixed rich-text format, renderer and editor. Legacy values require explicit host conversion.

Metadata version 4 supports group constraints. Saved compositions retain concrete component instances. Validated with 171 regression tests, builds, type checks, lint and package export checks.

## 2.0.0

Breaking rebuild of Reactive Forge around portable component metadata and versioned composition documents.

- Extract public components through configured roots and reexports; generate registries and standalone browser bundles.
- Validate, preview, visually compose and export nested React components to TSX.
- Annotate nested slots and rich-text restrictions; control prop presentation using provenance and explicit overrides.
- Support Date, URL, Map, Set, RegExp and custom class adapters through serialization, preview and code export.
- Introduce schema, runtime and editor packages alongside codegen. Existing shared/ui APIs require migration.

Package versions are distinct from document versions: metadata supports versions 1–3, and class-valued compositions use version 4. Version-3 compositions without class values remain readable; older compositions use explicit migration helpers.
