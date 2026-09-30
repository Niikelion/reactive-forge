import { defineComponentMetadata, defineLibraryMetadata, externalComponent } from "../../../../../packages/codegen/src/slotAuthoring";

// Companion library-metadata module for tests/fixtures/node_modules/rf-demo-widgets - phase 4's
// externally-annotated library component (docs/claude-slots-handoff.md "Real browser
// acceptance"), following the exact pattern tests/fixtures/annotations/libraryMeta/widgetsMeta.ts
// already established for phase 1's own fixture (`defineLibraryMetadata` + `externalComponent`).
//
// This is a SEPARATE, additive companion module - it does not touch
// tests/fixtures/bundle-project/src/components/SlotCard.tsx's own colocated
// `SlotCardMetadata`, per file ownership. `Badge` needs no rules of its own (it has no
// ReactNode/ComponentType-domain props to constrain); its presence here is what makes codegen
// resolve its `.d.ts`, assign it a stable external identity/id, and add it to
// metadata.json's `components`/`externalLibraries` - see tests/fixtures/editor-demo/forge.demo.config.ts's
// `annotationSources.libraries` entry that wires this module in.
export default defineLibraryMetadata({
  compatibleVersions: "^2.0.0",
  components: [
    defineComponentMetadata(externalComponent("rf-demo-widgets", "Badge"), {
      rules: [],
    }),
  ],
});
