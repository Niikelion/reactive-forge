import path from "path";
import {CodegenConfig, createCodegen} from "@reactive-forge/codegen";
import { PluginOption } from "vite";

type ReactiveForgePluginConfig = Partial<CodegenConfig>

export const reactiveForge = (config?: ReactiveForgePluginConfig): PluginOption => {
    let projectRootDir = process.cwd()

    return {
        name: 'vite-plugin-react-reactive-forge',
        config(config) {
            projectRootDir = config.root ?? projectRootDir
        },
        async buildStart() {
            const rootDir = config?.rootDir ?? projectRootDir
            const baseDir = config?.baseDir ?? "./src"
            const tsConfigFilePath = config?.tsConfigFilePath ?? path.resolve(rootDir, "./tsconfig.app.json")
            const reactTypesFilePath = config?.reactTypesFilePath ?? path.resolve(rootDir, "./node_modules/typescript/lib")
            const outDir = config?.outDir ?? path.resolve(rootDir, "./reactive-forge")
            const pathPrefix = config?.pathPrefix ?? "@/"

            await createCodegen({
                tsConfigFilePath,
                reactTypesFilePath,
                outDir,
                rootDir,
                baseDir,
                pathPrefix
            })
        }
    }
}