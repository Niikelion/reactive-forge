# Reactive Forge

Extract exported React components into portable prop metadata and a component registry. Compose them visually, validate and render compositions, and export them to TSX.

## Packages

- [codegen](packages/codegen/README.md): extraction, annotations, registry generation and browser bundling.
- [schema](packages/schema/README.md): portable schemas, slot policies and prop presentation.
- [runtime](packages/runtime/README.md): validation, rendering, class adapters and TSX export.
- [editor](packages/editor/README.md): preview, prop controls and nested composition canvas.
- [vite](packages/vite/README.md): extraction during Vite development and production builds.
- [next](packages/next/README.md): generation and development watching for Next.js with Turbopack or Webpack.

See [CHANGELOG.md](CHANGELOG.md) and package changelogs for released versions. Package versions are separate from document schema versions.

React is supplied by the host application. All stable React 19.x versions are supported (`^19.0.0`); TypeScript users supply matching React 19 types. CI verifies the React 19.0 baseline and the latest React 19.x release.

## Development

Run yarn install, yarn build, yarn typecheck, yarn lint, yarn test:regressions and yarn check:packages.

Test utilities live in tests/support/. Build the interactive fixture with node tests/support/build-editor-demo.cjs.

## Capabilities

- Public component discovery through configured source directories, entry files and reexports.
- Colocated and external annotations for nested ReactNode slots, allowed components and component groups.
- Prop presentation based on provenance, required inputs and explicit overrides.
- Date, URL, Map, Set, RegExp and explicitly registered custom class values.
- Versioned compositions, independent component bundles and validated TSX export.

Class payloads are trees: cycles and shared reference identity are not preserved. Constructor references and resource handles require separate host integration.

## Releases

Run `yarn changeset` for public package changes and commit the generated file with your code. Merging into `master` verifies the packages, bumps all six public package versions together, publishes them to npm, and creates GitHub releases. CI and documentation-only changes need no version bump. See [.changeset/README.md](.changeset/README.md) for setup and recovery.
