// Separate config/outDir for tests/export.test.cjs (gate E), mirroring
// forge.runtime.config.ts's rationale: node's test runner runs test files
// concurrently, and multiple test files regenerating the same fixture
// project's output directory raced in the past (see forge.runtime.config.ts).
// This file gets its own isolated `out-export/`, distinct from `out/`,
// `out-runtime/`, `out-editor/`, and `out-runtime-v2/`.
//
// `annotationSources.colocated: true` (phase 3 addition, mirroring
// forge.runtime-v2.config.ts) - makes codegen scan this project's
// componentRoots for `defineComponentMetadata` calls (SlotCard.tsx,
// RichTextShowcase.tsx), producing a schemaVersion: 2 metadata.json with a
// real `slots` array, needed by tests/export.test.cjs's "nodes"/"richText"/
// "componentRef" slot-export coverage.
import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	baseDir: "./src",
	componentRoots: ["./src/components"],
	tsConfigFilePath: "./tsconfig.json",
	typescriptLibPath: "../../../node_modules/typescript/lib",
	outDir: "./out-export",
	pathPrefix: "fixture/",
	annotationSources: { colocated: true }
} satisfies ForgeConfig
