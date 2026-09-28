import { defineComponentMetadata, defineLibraryMetadata, externalComponent } from "../../../../packages/codegen/src/slotAuthoring";

// Points at a package that does not exist anywhere in node_modules - exercises "library-not-found".
export default defineLibraryMetadata({
  compatibleVersions: "^1.0.0",
  components: [
    defineComponentMetadata(externalComponent("rf-fixture-does-not-exist", "Button"), { rules: [] }),
  ],
});
