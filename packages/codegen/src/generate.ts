import {Project, SourceFile} from "ts-morph";
import {ComponentData} from "./types";
import path from "path";
import fs from "fs/promises";

async function saveFileIfChanged(file: SourceFile): Promise<void> {
    if (!await fileContentChanged(file.getFilePath(), file.getFullText())) return

    console.log(`[reactive-forge]: Updating ${file.getFilePath()}`)
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

export type GenerateConfig = {
    outDir: string
    rootDir: string
    baseDir: string
    pathPrefix: string
}

export async function generateFiles(project: Project, components: ComponentData[], { outDir, rootDir, baseDir, pathPrefix }: GenerateConfig)
{
    type ImportInstance = {
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
        if (declarations.length === 0) continue

        const sourceFile = declarations[0].getSourceFile()
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
            moduleSpecifier: "@reactive-forge/shared",
            namedImports: ["ComponentFile"]
        })

        resultFile.addImportDeclaration({
            moduleSpecifier: module.specifier,
            namedImports: module.names.size > 0 ? [...module.names.values()].map(name => ({ name })) : undefined,
            defaultImport: module.defaultName
        })

        const relativePath = path.relative(outDir, module.targetPath)
        const filePath = path.relative(baseDir, relativePath).replace(/\.(tsx|ts)/, "").replace(/\\/g, "/")

        resultFile.addStatements(`export const __file = new ComponentFile(\n\t"${pathPrefix}${filePath}",\n\t{\n${module.components.map(c => `\t\t${c.name}: {\n\t\t\tcomponent: ${c.name} as FC,\n\t\t\targs: ${JSON.stringify(c.args)}\n\t}`).join(", ")}\n\t}\n)`)
        resultFile.formatText()

        await saveFileIfChanged(resultFile)
    }

    const aggregateFile = project.createSourceFile(path.resolve(outDir, "./index.ts"), "", { overwrite: true })

    const libraryFiles: string[] = []

    aggregateFile.addImportDeclaration({
        moduleSpecifier: "@reactive-forge/shared",
        namedImports: ["ComponentLibrary"]
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

    aggregateFile.addStatements(`export const components = new ComponentLibrary(\n${libraryFiles.map(f => `\t${f}`).join(",\n")}\n);`)

    await saveFileIfChanged(aggregateFile)
}