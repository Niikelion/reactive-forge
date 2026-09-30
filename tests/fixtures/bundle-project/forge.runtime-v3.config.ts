// Separate config/outDir for tests/runtime-v3.test.cjs (recursive composition values and policy
// enforcement, docs/slot-contract-recursive.md), mirroring forge.runtime-v2.config.ts's rationale:
// node's test runner runs test files concurrently, and multiple test files regenerating the same
// fixture project's output directory raced in the past. This file gets its own isolated
// `out-runtime-v3/`. Same `annotationSources.colocated: true` as forge.runtime-v2.config.ts - this
// project's `defineComponentMetadata` calls (including NestedSlotCard.tsx's, added for this file)
// produce a real schemaVersion: 2 metadata.json with a real `slots` array.
import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	baseDir: "./src",
	componentRoots: ["./src/components"],
	tsConfigFilePath: "./tsconfig.json",
	typescriptLibPath: "../../../node_modules/typescript/lib",
	outDir: "./out-runtime-v3",
	pathPrefix: "fixture/",
	annotationSources: { colocated: true }
} satisfies ForgeConfig
