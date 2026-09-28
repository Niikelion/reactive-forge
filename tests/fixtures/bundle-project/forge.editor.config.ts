// Separate config/outDir for tests/editor.test.cjs (gate D, part 2, extended in phase 3 for
// slot outlets), mirroring forge.runtime.config.ts's rationale: node's test runner runs test
// files concurrently, and multiple test files regenerating the same fixture project's output
// directory raced in the past (see forge.runtime.config.ts). This file gets its own isolated
// `out-editor/`, distinct from `out/` and `out-runtime/`/`out-runtime-v2/`.
//
// `annotationSources.colocated: true` (added in phase 3, mirroring forge.runtime-v2.config.ts)
// makes codegen produce a schemaVersion: 2 metadata.json with a real `slots` array, including
// SlotCard's colocated rules - tests/editor.test.cjs's slot-outlet tests (palette filtering,
// insertion/rejection, reordering, richText, componentRef) need a real SlotCard component to
// drive, exactly like tests/runtime-v2.test.cjs already does for the bare runtime.
import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	baseDir: "./src",
	componentRoots: ["./src/components"],
	tsConfigFilePath: "./tsconfig.json",
	typescriptLibPath: "../../../node_modules/typescript/lib",
	outDir: "./out-editor",
	pathPrefix: "fixture/",
	annotationSources: { colocated: true }
} satisfies ForgeConfig
