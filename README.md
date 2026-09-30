# Reactive Forge

Extract exported React components into portable prop metadata and a component registry. Compose them visually, validate and render compositions, and export them to TSX.

## Packages

- [codegen](packages/codegen/README.md): extraction, annotations, registry generation and browser bundling.
- [schema](packages/schema/README.md): portable schemas, slot policies and prop presentation.
- [runtime](packages/runtime/README.md): validation, rendering, class adapters and TSX export.
- [editor](packages/editor/README.md): preview, prop controls and nested composition canvas.

The coordinated 2.0.0 release is prepared; see [CHANGELOG.md](CHANGELOG.md). Package versions are separate from document schema versions.

## Development

Run yarn install, yarn build, yarn typecheck, yarn lint, yarn test:regressions and yarn check:packages.

Test utilities live in tests/support/. Build the interactive fixture with node tests/support/build-editor-demo.cjs.

## Capabilities

- Public component discovery through configured source directories, entry files and reexports.
- Colocated and external annotations for nested ReactNode slots, allowed components and rich text.
- Prop presentation based on provenance, required inputs and explicit overrides.
- Date, URL, Map, Set, RegExp and explicitly registered custom class values.
- Versioned compositions, independent component bundles and validated TSX export.

Class payloads are trees: cycles and shared reference identity are not preserved. Constructor references and resource handles require separate host integration.
