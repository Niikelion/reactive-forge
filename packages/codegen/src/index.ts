import {Project} from "ts-morph"
import {extractComponents} from "./extract.js"
import {GenerateConfig, generateFiles} from "./generate.js"
import path from "path";
import {createLogger} from "./utils";

export type CodegenConfig = {
    debug?: boolean
    silent?: string
    typescriptLibPath: string
    reactTypesFilePath?: string
    tsConfigFilePath: string
    componentRoots: string[]
} & GenerateConfig

export type ForgeConfig = Partial<CodegenConfig>

export function fillConfig(config: ForgeConfig, projectRootDir: string = "./"): CodegenConfig {
    const rootDir = config?.rootDir ?? projectRootDir
    const baseDir = config?.baseDir ?? "./src"
    const tsConfigFilePath = config?.tsConfigFilePath ?? path.resolve(rootDir, "./tsconfig.json")
    const typescriptLibPath = config?.typescriptLibPath ?? path.resolve(rootDir, "./node_modules/typescript/lib")
    const outDir = config?.outDir ?? path.resolve(rootDir, "./reactive-forge")
    const componentRoots = config?.componentRoots ?? [baseDir]
    const pathPrefix = config?.pathPrefix ?? "@/"

    return {
        ...config,
        tsConfigFilePath,
        typescriptLibPath,
        outDir,
        rootDir,
        baseDir,
        pathPrefix,
        componentRoots
    }
}

export const createCodegen = async (config: CodegenConfig, logger?: ReturnType<typeof createLogger>) => {
    logger ??= createLogger({ silent: false, prefix: true })

    const project = new Project({
        tsConfigFilePath: config.tsConfigFilePath,
        libFolderPath: config.typescriptLibPath
    })

    if (config.reactTypesFilePath !== undefined) {
        const f = project.addSourceFileAtPathIfExists(config.reactTypesFilePath)
        if (f === undefined)
            logger.error("Couldn't find specified react types file!")
    }

    if (config.debug) {
        const diagnostics = project.getPreEmitDiagnostics()
        logger.error(project.formatDiagnosticsWithColorAndContext(diagnostics))
    }

    try {
        const logFinished = logger.timing("Extracted components", true)
        const components = await extractComponents(project, config.componentRoots)
        await generateFiles(project, components, config, logger)
        logFinished()
    } catch (err) {
        logger.error(err instanceof Error ? err.toString() : "Unknown error")
    }
}