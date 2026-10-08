# @reactive-forge/runtime

## 2.3.0

### Minor Changes

- 94fa929: Add composition expressions and locals (schemaVersion 6). A value position can hold a typed, side-effect-free expression over the document's public props and locals: literals, prop and local references, property access, objects, conditionals, match, arithmetic, comparison, boolean and `??` operators, and calls to pure functions the host registers in the new `ComponentLibraryData.functions`. Validation types every expression against the position it fills; `renderComposition` evaluates them; `exportToTsx` writes locals as consts and expressions as plain TypeScript, and imports a called function like an external component. A slot that accepts anything takes an expression that produces text. Version 5 documents are unchanged.

  A field of a record-typed object value (an object schema with an index type, such as a style) now resolves to the index type, so one field can be bound or computed while the others stay literal.

### Patch Changes

- Updated dependencies [94fa929]
  - @reactive-forge/schema@2.3.0

## 2.2.0

### Patch Changes

- @reactive-forge/schema@2.2.0

## 2.1.0

### Minor Changes

- c521666: Add explicit public prop declarations and general recursive prop bindings for composition documents. Generated TSX exposes only the declared API, with portable schema types or explicitly referenced component prop types; it never injects a callback registry or invents inputs from callback names. Live rendering and editor previews accept declared input values, and validation diagnoses undeclared or incompatible bindings.

  Legacy callback references remain supported in live rendering but must be explicitly converted to declared function props before TSX export.

### Patch Changes

- @reactive-forge/schema@2.1.0

## 2.0.4

### Patch Changes

- 39ffefc: Emit node-slot children directly between JSX tags without wrapping them in a Fragment. Other node props retain their existing Fragment behavior.
  - @reactive-forge/schema@2.0.4

## 2.0.3

### Patch Changes

- 3af9466: Export the `children` prop between JSX opening and closing tags instead of as a JSX attribute. Preserve child value boundaries, escaping and runtime behavior; other React node props remain attributes.
  - @reactive-forge/schema@2.0.3

## 2.0.2

### Patch Changes

- 499b3dd: Support all stable React 19.x versions through a host-provided React peer (`^19.0.0`). React types are optional peers covering 19.x. Avoid installing a second React copy and verify compatibility against React 19.0.0 and the latest React 19.x in CI.
- Updated dependencies [499b3dd]
  - @reactive-forge/schema@2.0.2
