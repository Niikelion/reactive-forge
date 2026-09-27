import {Project, SourceFile} from "ts-morph";
import {ComponentData} from "./types.js";
import path from "path";
import fs from "fs/promises";
import {Logger} from "./utils.js";
import {ObjectSchema} from "@reactive-forge/schema";

async function saveFileIfChanged(file: SourceFile, logger: Logger): Promise<void> {
    if (!await fileContentChanged(file.getFilePath(), file.getFullText())) return

    logger.info(`Updating ${file.getFilePath()}`)
    await file.save()
}

async function fileContentChanged(filePath: string, content: string): Promise<boolean> {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8')
        return content !== fileContent
    } catch {
        return true
    }
}

export interface GenerateConfig {
    outDir: string
    rootDir: string
    baseDir: string
    pathPrefix: string
}

export async function generateFiles(project: Project, components: ComponentData[], { outDir, rootDir, baseDir, pathPrefix }: GenerateConfig, logger: Logger)
{
    interface ImportInstance {
        names: Set<string>
        defaultName?: string
        specifier: string
        targetPath: string
        sourcePath: string
        components: ComponentData[]
    }

    const importMap = new Map<string, ImportInstance>

    for (const component of components) {
        const declarations = component.symbol.getDeclarations()
        const firstDecl = declarations[0]
        if (!firstDecl) continue

        const sourceFile = firstDecl.getSourceFile()
        const sourcePath = sourceFile.getFilePath()

        let importInstance: ImportInstance | undefined = importMap.get(sourcePath)

        if (importInstance === undefined) {
            const targetPath = path.resolve(outDir, path.relative(rootDir, sourcePath)).replace(/\\/g, "/")
            const specifier = path.relative(path.dirname(targetPath), sourcePath).replace(/\.(tsx|ts)/, "").replace(/\\/g, "/")

            importInstance = {
                defaultName: undefined,
                names: new Set<string>(),
                specifier,
                targetPath,
                sourcePath,
                components: []
            }

            importMap.set(sourcePath, importInstance)
        }

        importInstance.components.push(component)

        if (component.isDefault)
            importInstance.defaultName ??= component.name
        else
            importInstance.names.add(component.name)
    }

    const modules = [...importMap.values()]

    for (const module of modules) {
        const resultFile = project.createSourceFile(module.targetPath, "", { overwrite: true })

        resultFile.addImportDeclaration({
            moduleSpecifier: "react",
            namedImports: [{ name: "FC", isTypeOnly: true }]
        })
        resultFile.addImportDeclaration({
            moduleSpecifier: "@reactive-forge/schema",
            namedImports: [{ name: "ComponentFileData", isTypeOnly: true }]
        })

        resultFile.addImportDeclaration({
            moduleSpecifier: module.specifier,
            namedImports: module.names.size > 0 ? [...module.names.values()].map(name => ({ name })) : undefined,
            defaultImport: module.defaultName
        })

        const relativePath = path.relative(outDir, module.targetPath)
        const filePath = path.relative(baseDir, relativePath).replace(/\.(tsx|ts)/, "").replace(/\\/g, "/")

        const componentEntries = module.components.map(c => {
            const argsJson = JSON.stringify(new ObjectSchema(c.args).toJson())
            return `\t\t${c.name}: {\n\t\t\tcomponent: ${c.name} as FC,\n\t\t\targs: ${argsJson}\n\t\t}`
        }).join(",\n")

        resultFile.addStatements(
            `export const __file: ComponentFileData = {\n\tpath: "${pathPrefix}${filePath}",\n\tcomponents: {\n${componentEntries}\n\t}\n}`
        )
        resultFile.formatText()

        await saveFileIfChanged(resultFile, logger)
    }

    const aggregateFile = project.createSourceFile(path.resolve(outDir, "./index.ts"), "", { overwrite: true })

    const libraryFiles: string[] = []

    aggregateFile.addImportDeclaration({
        moduleSpecifier: "@reactive-forge/schema",
        namedImports: [{ name: "ComponentLibraryData", isTypeOnly: true }]
    })

    modules.forEach(module => {
        const relativePath = path.relative(outDir, module.targetPath).replace(/\.(tsx|ts)/, "").replace(/\\/g, "/")

        const alias = relativePath.replace(/\//g, "_")

        aggregateFile.addImportDeclaration({
            moduleSpecifier: `./${relativePath}`,
            namedImports: [{
                name: "__file",
                alias
            }]
        })

        libraryFiles.push(alias)
    })

    aggregateFile.addStatements(
        `export const components: ComponentLibraryData = {\n\tfiles: [\n${libraryFiles.map(f => `\t\t${f}`).join(",\n")}\n\t]\n}`
    )

    await saveFileIfChanged(aggregateFile, logger)
}
