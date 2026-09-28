import {Project} from "ts-morph"
import {registerCommonSchemas} from "@reactive-forge/schema"
import {extractComponents} from "./extract.js"
import {GenerateConfig, generateFiles} from "./generate.js"
import path from "path";
import {createLogger} from "./utils.js";
import type {AnnotationSourcesConfig} from "./slotTypes.js";

export type {AnnotationSourcesConfig} from "./slotTypes.js";

// docs/slot-contract.md section 5, "Annotation source discovery (config)". `metadataModule`
// entries and `overrideSources` are resolved to absolute paths by fillConfig below, the same
// root-anchoring convention every other relative-path field in this config already uses.
export type CodegenConfig = {
    debug?: boolean
    silent?: string
    typescriptLibPath: string
    reactTypesFilePath?: string
    tsConfigFilePath: string
    componentRoots: string[]
    annotationSources?: AnnotationSourcesConfig
} & GenerateConfig

export type ForgeConfig = Partial<CodegenConfig>

// All relative paths in a config file (rootDir, baseDir, tsConfigFilePath,
// typescriptLibPath, outDir, reactTypesFilePath, componentRoots) anchor to
// `projectRootDir`, not to the process's current working directory. Callers
// that load a config file (bin.ts) pass the config file's own directory as
// `projectRootDir`, so a config's relative paths behave the same regardless
// of where the CLI is invoked from. Callers that already resolved every path
// to an absolute path (for example direct API/test callers) are unaffected,
// since `path.resolve` leaves an absolute path unchanged.
export function fillConfig(config: ForgeConfig, projectRootDir = "./"): CodegenConfig {
    const anchor = path.resolve(projectRootDir)
    const rootDir = path.resolve(anchor, config.rootDir ?? "./")
    const baseDir = path.resolve(rootDir, config.baseDir ?? "./src")
    const tsConfigFilePath = path.resolve(rootDir, config.tsConfigFilePath ?? "./tsconfig.json")
    const typescriptLibPath = path.resolve(rootDir, config.typescriptLibPath ?? "./node_modules/typescript/lib")
    const outDir = path.resolve(rootDir, config.outDir ?? "./reactive-forge")
    const componentRoots = (config.componentRoots ?? [baseDir]).map(root => path.resolve(rootDir, root))
    const pathPrefix = config.pathPrefix ?? "@/"

    const annotationSources: AnnotationSourcesConfig | undefined = config.annotationSources && {
        ...config.annotationSources,
        ...(config.annotationSources.libraries !== undefined ? {
            libraries: config.annotationSources.libraries.map(library => ({
                ...library,
                metadataModule: path.resolve(rootDir, library.metadataModule)
            }))
        } : {}),
        ...(config.annotationSources.overrideSources !== undefined ? {
            overrideSources: config.annotationSources.overrideSources.map(source => path.resolve(rootDir, source))
        } : {})
    }

    return {
        ...config,
        tsConfigFilePath,
        typescriptLibPath,
        outDir,
        rootDir,
        baseDir,
        pathPrefix,
        componentRoots,
        ...(annotationSources !== undefined ? { annotationSources } : {}),
        ...(config.reactTypesFilePath !== undefined ? { reactTypesFilePath: path.resolve(rootDir, config.reactTypesFilePath) } : {})
    }
}

export const createCodegen = async (config: CodegenConfig, logger?: ReturnType<typeof createLogger>) => {
    logger ??= createLogger({ silent: false, prefix: true })

    registerCommonSchemas()

    const project = new Project({
        tsConfigFilePath: config.tsConfigFilePath,
        libFolderPath: config.typescriptLibPath
    })

    if (config.reactTypesFilePath !== undefined) {
        const f = project.addSourceFileAtPathIfExists(config.reactTypesFilePath)
        if (f === undefined)
            throw new Error("Couldn't find specified react types file!")
    }

    if (config.debug) {
        const diagnostics = project.getPreEmitDiagnostics()
        logger.error(project.formatDiagnosticsWithColorAndContext(diagnostics))
    }

    const logFinished = logger.timing("Extracted components", true)
    const components = extractComponents(project, config.componentRoots)
    await generateFiles(project, components, config, logger)
    logFinished()
}
