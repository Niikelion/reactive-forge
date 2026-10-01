# @reactive-forge/runtime

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
