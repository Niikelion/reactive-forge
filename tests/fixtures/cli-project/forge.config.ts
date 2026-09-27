import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	baseDir: "./src",
	tsConfigFilePath: "./tsconfig.json",
	typescriptLibPath: "../../../node_modules/typescript/lib",
	outDir: "./out",
	pathPrefix: "fixture/"
} satisfies ForgeConfig
