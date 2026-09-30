import {Node, Project, Type} from "ts-morph"
import path from "path"
import {ClassTypeRef, SchemaJson} from "@reactive-forge/schema"

export interface ClassBinding {
    type: {module: string, exportName: string}
    id: string
    version: number
    payloadSchema: SchemaJson
    /** Explicit specialization for generic class bindings. */
    typeArguments?: SchemaJson[]
    runtime: {module: string, exportName: string}
}
export interface ClassExtractionOptions {rootDir?: string, classBindings?: ClassBinding[]}

export function resolveClassBindings(project: Project, rootDir: string, bindings: ClassBinding[]) {
    const ids = new Set<string>()
    return bindings.map((binding, i) => {
        if (ids.has(binding.id)) throw new Error(`Duplicate class adapter ID: ${binding.id}`)
        ids.add(binding.id)
        const probe = project.createSourceFile(path.join(rootDir, `__rf_class_binding_${String(i)}.ts`), "", {overwrite: false})
        try {
            const imp = probe.addImportDeclaration({moduleSpecifier: binding.type.module, namespaceImport: "Binding"})
            const source = imp.getModuleSpecifierSourceFile()
            const exported = source?.getExportSymbols().find(s => s.getName() === binding.type.exportName)
            const symbol = exported?.getAliasedSymbol() ?? exported
            if (!symbol) throw new Error(`Cannot resolve class binding ${binding.type.module}#${binding.type.exportName}`)
            return {binding, declarations: symbol.getDeclarations()}
        } finally { probe.forget() }
    })
}

export function classReference(type: Type, rootDir: string): ClassTypeRef | undefined {
    const symbol = type.getSymbol()
    const declarations = symbol?.getDeclarations() ?? []
    const builtin = declarations.find(d => /\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(d.getSourceFile().getFilePath().replace(/\\/g, "/")))
    if (builtin && (Node.isInterfaceDeclaration(builtin) || Node.isClassDeclaration(builtin)))
        return {kind: "builtin", name: symbol?.getName() ?? "unknown"}
    const declaration = declarations.find(Node.isClassDeclaration)
    if (!declaration) return undefined
    const file = declaration.getSourceFile().getFilePath().replace(/\\/g, "/")
    const packageMatch = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*)/.exec(file)
    if (packageMatch) return {kind: "external", package: packageMatch[1] ?? "", subpath: packageMatch[2], exportName: symbol?.getName() ?? "default"}
    return {kind: "project", sourcePath: path.relative(rootDir, file).replace(/\\/g, "/"), exportName: symbol?.getName() ?? "default"}
}
