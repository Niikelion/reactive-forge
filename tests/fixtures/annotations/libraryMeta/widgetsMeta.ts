import { defineComponentMetadata, defineLibraryMetadata, externalComponent } from "../../../../packages/codegen/src/slotAuthoring";

// Companion library-metadata module for the local fixture package `rf-fixture-widgets`
// (tests/fixtures/annotations/node_modules/rf-fixture-widgets), a "genuine node_modules-nested
// fixture" (per the handoff's judgment call, documented in the codegen worker's final report).
// `Button` is a real, valid export; `MissingExport` deliberately names an export that does not
// exist, to exercise "external-export-missing" scoped to just that one component while the rest
// of the library's rules still apply (docs/slot-contract.md section 5).
export default defineLibraryMetadata({
  compatibleVersions: "^1.0.0",
  components: [
    defineComponentMetadata(externalComponent("rf-fixture-widgets", "Button"), {
      rules: [{ path: ["icon"], slot: { kind: "any", maxItems: 1 } }],
    }),
    defineComponentMetadata(externalComponent("rf-fixture-widgets", "MissingExport"), {
      rules: [{ path: ["icon"], slot: { kind: "any" } }],
    }),
  ],
});
