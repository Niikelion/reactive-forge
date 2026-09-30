# Changelog

## 2.0.0

Breaking rebuild of Reactive Forge around portable component metadata and versioned composition documents.

- Extract public components through configured roots and reexports; generate registries and standalone browser bundles.
- Validate, preview, visually compose and export nested React components to TSX.
- Annotate nested slots and rich-text restrictions; control prop presentation using provenance and explicit overrides.
- Support Date, URL, Map, Set, RegExp and custom class adapters through serialization, preview and code export.
- Introduce schema, runtime and editor packages alongside codegen. Existing shared/ui APIs require migration.

Package versions are distinct from document versions: metadata supports versions 1–3, and class-valued compositions use version 4. Version-3 compositions without class values remain readable; older compositions use explicit migration helpers.
