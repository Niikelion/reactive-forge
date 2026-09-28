// Config for the interactive browser demo (tests/editor-demo.test.cjs +
// manual Browser-pane verification, see docs/baseline.md "Interactive
// browser verification"). Deliberately its own config/outDir, mirroring
// forge.runtime.config.ts/forge.editor.config.ts/forge.export.config.ts's
// rationale in tests/fixtures/bundle-project/: node's test runner runs test
// files concurrently, and multiple test files regenerating the same output
// directory raced in the past.
//
// This file lives in tests/fixtures/editor-demo/ (this demo's own directory,
// per file ownership), not tests/fixtures/bundle-project/ - but it reuses
// the real Greeter/Card fixture components from bundle-project rather than
// hand-rolling a fake registry. `rootDir` is set to the shared `tests/fixtures`
// ancestor (generate.ts's `generateFiles` refuses a component source path
// outside `rootDir` - "Component source is outside rootDir" - so `rootDir`
// must be a common ancestor of both this config file's directory and
// bundle-project's `src/components`, not this directory alone). Every other
// relative path below (`baseDir`, `componentRoots`, `tsConfigFilePath`,
// `typescriptLibPath`, `outDir`) is resolved against that `rootDir` by
// `fillConfig` (packages/codegen/src/index.ts) - not against this config
// file's own directory - so `outDir` is spelled relative to `tests/fixtures`
// to still land inside this directory (`./editor-demo/out-demo`).
import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	rootDir: "../",
	baseDir: "./bundle-project/src",
	componentRoots: ["./bundle-project/src/components"],
	tsConfigFilePath: "./bundle-project/tsconfig.json",
	typescriptLibPath: "../../node_modules/typescript/lib",
	outDir: "./editor-demo/out-demo",
	pathPrefix: "fixture/",
	// Phase 3 addition (docs/claude-slots-handoff.md): the demo now exercises real slot
	// outlets (SlotCard's actions/icon/caption), which only exist in a schemaVersion 2
	// metadata.json with colocated annotations turned on - mirrors
	// tests/fixtures/bundle-project/forge.runtime-v2.config.ts/forge.editor.config.ts.
	annotationSources: { colocated: true }
} satisfies ForgeConfig
