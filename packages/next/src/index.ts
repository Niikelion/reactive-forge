import path from "path"
import {CodegenConfig, createCodegen} from "@reactive-forge/codegen"
import {NextConfig} from "next"
import {WebpackPluginInstance, Compiler} from "webpack"

class ReactiveForgeWebpackPlugin implements WebpackPluginInstance {
    private readonly config: CodegenConfig

    constructor(config: CodegenConfig) {
        this.config = config
    }

    apply(compiler: Compiler) {
        const codegen = async () => await createCodegen(this.config)

        compiler.hooks.beforeRun.tapPromise("ReactiveForgeWebpackPlugin", codegen)
        compiler.hooks.watchRun.tapPromise("ReactiveForgeWebpackPlugin", codegen)
    }
}

type ReactiveForgePluginConfig = Partial<CodegenConfig>

export const withReactiveForge = (reactiveForgeConfig: ReactiveForgePluginConfig) => function(nextConfig: NextConfig): NextConfig {
    const projectRootDir = process.cwd()

    return {
        ...nextConfig,
        webpack(config, options) {
            const rootDir = reactiveForgeConfig?.rootDir ?? projectRootDir
            const baseDir = reactiveForgeConfig?.baseDir ?? "./src"
            const tsConfigFilePath = reactiveForgeConfig?.tsConfigFilePath ?? path.resolve(rootDir, "./tsconfig.app.json")
            const reactTypesFilePath = reactiveForgeConfig?.reactTypesFilePath ?? path.resolve(rootDir, "./node_modules/typescript/lib")
            const outDir = reactiveForgeConfig?.outDir ?? path.resolve(rootDir, "./reactive-forge")
            const componentRoots = reactiveForgeConfig?.componentRoots ?? [baseDir]
            const pathPrefix = reactiveForgeConfig?.pathPrefix ?? "@/"

            config.plugins.push(new ReactiveForgeWebpackPlugin({
                tsConfigFilePath,
                reactTypesFilePath,
                outDir,
                rootDir,
                baseDir,
                pathPrefix,
                componentRoots
            }))

            if (nextConfig.webpack)
                return nextConfig.webpack(config, options)
            return config
        }
    }
}