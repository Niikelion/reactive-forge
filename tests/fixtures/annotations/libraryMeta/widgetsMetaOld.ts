import { defineComponentMetadata, defineLibraryMetadata, externalComponent } from "../../../../packages/codegen/src/slotAuthoring";

// Same `compatibleVersions` range as widgetsMeta.ts, but pointed at the deliberately old fixture
// package (0.5.0, tests/fixtures/annotations/node_modules/rf-fixture-widgets-old) - exercises
// "library-version-incompatible".
export default defineLibraryMetadata({
  compatibleVersions: "^1.0.0",
  components: [
    defineComponentMetadata(externalComponent("rf-fixture-widgets-old", "Button"), { rules: [] }),
  ],
});
