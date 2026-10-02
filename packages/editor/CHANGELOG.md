# @reactive-forge/editor

## 2.2.0

### Patch Changes

- @reactive-forge/schema@2.2.0
- @reactive-forge/runtime@2.2.0

## 2.1.0

### Minor Changes

- c521666: Add explicit public prop declarations and general recursive prop bindings for composition documents. Generated TSX exposes only the declared API, with portable schema types or explicitly referenced component prop types; it never injects a callback registry or invents inputs from callback names. Live rendering and editor previews accept declared input values, and validation diagnoses undeclared or incompatible bindings.

  Legacy callback references remain supported in live rendering but must be explicitly converted to declared function props before TSX export.

### Patch Changes

- Updated dependencies [c521666]
  - @reactive-forge/runtime@2.1.0
  - @reactive-forge/schema@2.1.0

## 2.0.4

### Patch Changes

- Updated dependencies [39ffefc]
  - @reactive-forge/runtime@2.0.4
  - @reactive-forge/schema@2.0.4

## 2.0.3

### Patch Changes

- Updated dependencies [3af9466]
  - @reactive-forge/runtime@2.0.3
  - @reactive-forge/schema@2.0.3

## 2.0.2

### Patch Changes

- 499b3dd: Support all stable React 19.x versions through a host-provided React peer (`^19.0.0`). React types are optional peers covering 19.x. Avoid installing a second React copy and verify compatibility against React 19.0.0 and the latest React 19.x in CI.
- Updated dependencies [499b3dd]
  - @reactive-forge/schema@2.0.2
  - @reactive-forge/runtime@2.0.2
