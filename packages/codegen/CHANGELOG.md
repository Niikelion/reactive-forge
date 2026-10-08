# @reactive-forge/codegen

## 2.3.0

### Patch Changes

- Updated dependencies [94fa929]
  - @reactive-forge/schema@2.3.0

## 2.2.0

### Minor Changes

- 4958bc5: Restore Vite and Next.js integrations using a shared generation service. Regenerate component metadata and registries during development, generate before production compilation, reload extraction configuration, and clean up watchers when development stops. Next.js integration runs independently of Webpack hooks and supports Turbopack.

  Include both framework packages in coordinated releases and package checks.

### Patch Changes

- @reactive-forge/schema@2.2.0

## 2.1.0

### Patch Changes

- @reactive-forge/schema@2.1.0

## 2.0.4

### Patch Changes

- @reactive-forge/schema@2.0.4

## 2.0.3

### Patch Changes

- @reactive-forge/schema@2.0.3

## 2.0.2

### Patch Changes

- 499b3dd: Support all stable React 19.x versions through a host-provided React peer (`^19.0.0`). React types are optional peers covering 19.x. Avoid installing a second React copy and verify compatibility against React 19.0.0 and the latest React 19.x in CI.
- Updated dependencies [499b3dd]
  - @reactive-forge/schema@2.0.2
