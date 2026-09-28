// Separate config/outDir for tests/runtime-v2.test.cjs (phase 2 of the slot-contract work,
// docs/slot-contract.md sections 7-8, 10), mirroring forge.runtime.config.ts's rationale: node's
// test runner runs test files concurrently, and multiple test files regenerating the same fixture
// project's output directory raced in the past. This file gets its own isolated `out-runtime-v2/`.
//
// `annotationSources.colocated: true` is the only difference from the sibling v1 config - it makes
// codegen scan this project's componentRoots for `defineComponentMetadata` calls (see
// src/components/SlotCard.tsx), producing a schemaVersion: 2 metadata.json with a real `slots`
// array instead of the plain v1 document forge.runtime.config.ts produces.
import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	baseDir: "./src",
	componentRoots: ["./src/components"],
	tsConfigFilePath: "./tsconfig.json",
	typescriptLibPath: "../../../node_modules/typescript/lib",
	outDir: "./out-runtime-v2",
	pathPrefix: "fixture/",
	annotationSources: { colocated: true }
} satisfies ForgeConfig
