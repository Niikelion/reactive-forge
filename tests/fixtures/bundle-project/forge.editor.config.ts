// Separate config/outDir for tests/editor.test.cjs (gate D, part 2), mirroring
// forge.runtime.config.ts's rationale: node's test runner runs test files
// concurrently, and multiple test files regenerating the same fixture
// project's output directory raced in the past (see forge.runtime.config.ts).
// This file gets its own isolated `out-editor/`, distinct from `out/` and
// `out-runtime/`.
import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	baseDir: "./src",
	componentRoots: ["./src/components"],
	tsConfigFilePath: "./tsconfig.json",
	typescriptLibPath: "../../../node_modules/typescript/lib",
	outDir: "./out-editor",
	pathPrefix: "fixture/"
} satisfies ForgeConfig
