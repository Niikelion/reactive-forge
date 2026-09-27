// Separate config, same fixture project, distinct outDir from
// forge.config.ts. tests/bundle.test.cjs and tests/runtime.test.cjs both
// exercise this same fixture project's real CLI pipeline (`forge codegen`
// then `forge bundle`); node's test runner can run test files concurrently,
// and both files' cleanup-then-regenerate-then-cleanup steps raced on a
// shared `out/` directory. A distinct config/outDir per test file gives each
// its own isolated output, with no shared mutable state between them.
import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	baseDir: "./src",
	componentRoots: ["./src/components"],
	tsConfigFilePath: "./tsconfig.json",
	typescriptLibPath: "../../../node_modules/typescript/lib",
	outDir: "./out-runtime",
	pathPrefix: "fixture/"
} satisfies ForgeConfig
