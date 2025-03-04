import type { ForgeConfig } from "@reactive-forge/codegen"

export default {
	rootDir: ".",
	baseDir: "src",
	componentRoots: ["src/components"],
	tsConfigFilePath: "tsconfig.json",
	outDir: "reactive-forge",
	pathPrefix: "@/",
	typescriptLibPath: "../../node_modules/typescript/lib",
	reactTypesFilePath: "../../node_modules/@types/react/index.d.ts"
} satisfies ForgeConfig