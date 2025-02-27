import {Project} from "ts-morph";
import {extractComponents} from "./extract.js";
import {GenerateConfig, generateFiles} from "./generate.js";

export type CodegenConfig = {
    reactTypesFilePath: string
    tsConfigFilePath: string
    componentRoots: string[]
} & GenerateConfig

export const createCodegen = async (config: CodegenConfig) => {
    const project = new Project({
        tsConfigFilePath: config.tsConfigFilePath,
        libFolderPath: config.reactTypesFilePath
    })

    const components = await extractComponents(project, config.componentRoots)
    await generateFiles(project, components, config)
}