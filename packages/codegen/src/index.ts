import {Project} from "ts-morph";
import {extractComponents} from "./extract.js";
import {GenerateConfig, generateFiles} from "./generate.js";

export type CodegenConfig = {
    debug?: boolean
    typescriptLibPath: string
    reactTypesFilePath?: string
    tsConfigFilePath: string
    componentRoots: string[]
} & GenerateConfig

export const createCodegen = async (config: CodegenConfig) => {
    const project = new Project({
        tsConfigFilePath: config.tsConfigFilePath,
        libFolderPath: config.typescriptLibPath
    })

    if (config.reactTypesFilePath !== undefined) {
        const f = project.addSourceFileAtPathIfExists(config.reactTypesFilePath)
        if (f === undefined)
            console.error("[reactive-forge]: Couldn't find specified react types file!")
    }

    if (config.debug) {
        const diagnostics = project.getPreEmitDiagnostics()
        console.log(project.formatDiagnosticsWithColorAndContext(diagnostics))
    }

    try {
        const components = await extractComponents(project, config.componentRoots)
        await generateFiles(project, components, config)
    } catch (err) {
        console.error(err)
    }
}