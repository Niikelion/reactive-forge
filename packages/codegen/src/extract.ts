import path from "path"
import {existsSync} from "fs"
import {
    ExportAssignment,
    ExportSpecifier,
    FunctionDeclaration,
    Node,
    Project,
    Signature,
    SourceFile,
    Symbol,
    ts,
    Type,
    VariableDeclaration
} from "ts-morph"
import {ComponentData} from "./types.js"
import {
    ArraySchema,
    BigIntSchema,
    BooleanSchema,
    DateSchema,
    intersect,
    NullSchema,
    NumberSchema,
    ObjectSchema,
    ReactNodeSchema,
    Schema,
    StringSchema,
    UndefinedSchema,
    UnionSchema,
} from "@reactive-forge/schema"

const isDefined = <T>(v: T | undefined | null): v is T => v !== null && v !== undefined
const isString = (v: unknown): v is string => v instanceof String || typeof v === "string"
const isNumber = (v: unknown): v is number => v instanceof Number || typeof v === "number"

function calculateOrDefault<T>(calculation: () => T, defaultValue: T)
{
    try {
        return calculation()
    } catch {
        return defaultValue
    }
}

function createUtils(project: Project, sourceDirectory: string)
{
    const source = `
        import {FC, ReactNode, JSX} from "react"
        export type ComponentReturnType = ReturnType<FC> | JSX.Element
        export type ReactNodeType = ReactNode
        export type DateType = Date
        export type TrueType = true
        export type FalseType = false
    `

    let helperPath = path.join(sourceDirectory, "__reactive_forge_utils_tmp_file.ts")
    for (let suffix = 1; project.getSourceFile(helperPath) || existsSync(helperPath); suffix++)
        helperPath = path.join(sourceDirectory, `__reactive_forge_utils_tmp_file_${suffix.toString()}.ts`)

    const tmpSourceFile = project.createSourceFile(helperPath, source)
    function getType(name: string)
    {
        return tmpSourceFile.getTypeAliasOrThrow(name).getType()
    }

    function extractTypes<T extends string[]>(...names: T): Record<T[number], Type>
    {
        const ret: Record<string, Type> = {}

        for (const name of names)
            ret[name] = getType(name)

        return ret
    }

    let types: Record<"ComponentReturnType" | "ReactNodeType" | "DateType" | "TrueType" | "FalseType", Type>
    try {
        types = extractTypes(
            "ComponentReturnType",
            "ReactNodeType",
            "DateType",
            "TrueType",
            "FalseType"
        )

        if (types.ReactNodeType.isAny())
            throw new Error("[reactive-forge]: Cannot find react types!")
    } catch (error) {
        tmpSourceFile.forget()
        throw error
    }

    function callSignatureFromType(type: Type): Signature | undefined {
        const callSignatures = type.getCallSignatures()

        if (callSignatures.length === 0) return undefined

        return callSignatures[0]
    }

    function getSignature(node: Node): Signature | undefined
    {
        if (node instanceof FunctionDeclaration) return node.getSignature()

        if (node instanceof VariableDeclaration) return callSignatureFromType(node.getType())

        if (node instanceof ExportAssignment)
        {
            const expression = node.getExpression()
            const type = expression.getType()
            return callSignatureFromType(type)
        }

        return undefined
    }

    function verifySignature(signature: Signature): boolean
    {
        // must return ReactNode or Promise<ReactNode>
        if (!signature.getReturnType().isAssignableTo(types.ComponentReturnType)) return false

        // type parameters not allowed
        if (signature.getTypeParameters().length > 0) return false

        const parameters = signature.getParameters()

        // at most 1 parameter - props
        return parameters.length <= 1;
    }

    function extractComponentData(signature: Signature | undefined, symbol: Symbol, name: string, sourcePath: string, isDefault: boolean): ComponentData | null
    {
        if (signature === undefined) return null

        if (!verifySignature(signature)) return null

        const args = calculateOrDefault(() => extractParameters(signature.getParameters()[0]), null)

        if (args === null) return null

        return {
            symbol,
            name,
            sourcePath,
            isDefault,
            args
        }
    }

    function extractParameters(propsSymbol: Symbol | undefined): ComponentData["args"]
    {
        if (propsSymbol === undefined) return {}

        const declaration = propsSymbol.getDeclarations()[0]
        if (!declaration) return {}

        const type = propsSymbol.getTypeAtLocation(declaration)

        const paramsSchema = typeToSchema(type, declaration)

        if (!(paramsSchema instanceof ObjectSchema))
            throw new Error("Props type is not an object")

        return paramsSchema.properties
    }

    function typeToSchema(type: Type, node: Node): Schema
    {
        if (types.ReactNodeType.isAssignableTo(type))
            return ReactNodeSchema.instance

        if (type.isArray()) {
            const elementType = type.getArrayElementType()
            if (!elementType) throw new Error("Could not get array element type")
            return new ArraySchema([], typeToSchema(elementType, node))
        }

        if (type.isAssignableTo(types.DateType))
            return DateSchema.instance

        const literalValue = type.getLiteralValue()
        const typeFlags = type.getFlags()

        if (typeFlags & ts.TypeFlags.Union) {
            const members = type.getUnionTypes().map(t => typeToSchema(t, node))
            // Flatten nested unions
            const flatMembers: Schema[] = []
            for (const m of members) {
                if (m instanceof UnionSchema) flatMembers.push(...m.types)
                else flatMembers.push(m)
            }
            return new UnionSchema(flatMembers)
        }

        if (typeFlags & ts.TypeFlags.Intersection)
            return type.getIntersectionTypes()
                .map(t => typeToSchema(t, node))
                .reduce((a, b) => intersect(a, b))

        if (typeFlags & ts.TypeFlags.StringLike)
            return new StringSchema(isString(literalValue) ? literalValue : undefined)

        if (typeFlags & ts.TypeFlags.NumberLike)
            return new NumberSchema(isNumber(literalValue) ? literalValue : undefined)

        if (typeFlags & ts.TypeFlags.BooleanLike)
            return new BooleanSchema(
                type.isAssignableTo(types.TrueType) ? true :
                type.isAssignableTo(types.FalseType) ? false : undefined
            )

        if (typeFlags & ts.TypeFlags.BigIntLike)
            return new BigIntSchema(typeof literalValue === "bigint" ? literalValue : undefined)

        switch (type.getFlags()) {
            case ts.TypeFlags.Null:
                return NullSchema.instance
            case ts.TypeFlags.Undefined:
                return UndefinedSchema.instance
            case ts.TypeFlags.Object: {
                const indexType = indexTypeToSchema(type.getStringIndexType(), node)

                const properties: ObjectSchema["properties"] = {}

                for (const prop of type.getProperties()) {
                    const required = !prop.isOptional()

                    try {
                        properties[prop.getName()] = {
                            schema: typeToSchema(prop.getTypeAtLocation(node), node),
                            required
                        }
                    } catch (err) {
                        if (required) throw err
                    }
                }

                return new ObjectSchema(properties, indexType)
            }
            default: {
                throw new Error(`Unsupported type ${type.getText()}`)
            }
        }
    }

    function indexTypeToSchema(valueType: Type | undefined, node: Node): Schema | undefined
    {
        if (valueType === undefined) return undefined

        try {
            return typeToSchema(valueType, node)
        } catch {
            return undefined
        }
    }

    return {
        getSignature,
        extractComponentData,
        dispose: () => { tmpSourceFile.forget() }
    }
}

function isRuntimeDeclaration(declaration: Node): boolean {
    if (declaration.getSourceFile().isDeclarationFile()) return false
    if (Node.isFunctionDeclaration(declaration)) return declaration.getBody() !== undefined
    if (Node.isVariableDeclaration(declaration))
        return !declaration.getVariableStatement()?.hasDeclareKeyword()
    return Node.isExportAssignment(declaration)
}

function exportedName(specifier: ExportSpecifier): string {
    const alias = specifier.getAliasNode()
    return alias && Node.isStringLiteral(alias) ? alias.getLiteralValue() :
        alias?.getText() ?? specifier.getName()
}

function isImportedOnlyAsType(sourceFile: SourceFile, name: string): boolean {
    return sourceFile.getImportDeclarations().some(declaration => {
        const namedImport = declaration.getNamedImports().find(specifier =>
            (specifier.getAliasNode()?.getText() ?? specifier.getName()) === name
        )
        const otherImport = declaration.getDefaultImport()?.getText() === name ||
            declaration.getNamespaceImport()?.getText() === name
        if (!namedImport && !otherImport) return false
        return declaration.isTypeOnly() || namedImport?.isTypeOnly() === true
    })
}

function isValueExported(sourceFile: SourceFile, name: string, visited = new Set<string>()): boolean {
    const key = `${sourceFile.getFilePath()}:${name}`
    if (visited.has(key)) return false
    visited.add(key)

    const publicSymbol = sourceFile.getExportSymbols().find(symbol => symbol.getName() === name)
    if (!publicSymbol) return false

    if (publicSymbol.getDeclarations().some(declaration =>
        declaration.getSourceFile() === sourceFile &&
        isRuntimeDeclaration(declaration)
    )) return true

    for (const exportDeclaration of sourceFile.getExportDeclarations()) {
        if (exportDeclaration.isTypeOnly()) continue
        const moduleFile = exportDeclaration.getModuleSpecifierSourceFile()

        for (const specifier of exportDeclaration.getNamedExports()) {
            if (specifier.isTypeOnly() || exportedName(specifier) !== name)
                continue

            if (moduleFile) {
                if (isValueExported(moduleFile, specifier.getName(), new Set(visited))) return true
            } else if (!exportDeclaration.getModuleSpecifier() &&
                !isImportedOnlyAsType(sourceFile, specifier.getName()) &&
                resolvedSymbol(publicSymbol).getDeclarations().some(isRuntimeDeclaration)) {
                return true
            }
        }

        if (moduleFile && exportDeclaration.getNamedExports().length === 0 &&
            isValueExported(moduleFile, name, new Set(visited))) return true
    }

    return false
}

function resolvedSymbol(symbol: Symbol): Symbol {
    return symbol.getAliasedSymbol() ?? symbol
}

function defaultName(symbol: Symbol): string {
    const declaration = symbol.getDeclarations().find(isRuntimeDeclaration)
    return declaration?.getFirstChild(node => node.isKind(ts.SyntaxKind.Identifier))?.getText() ?? "default"
}

function matchesRoot(sourcePath: string, rootPath: string): boolean {
    return sourcePath === rootPath || sourcePath.startsWith(rootPath.endsWith("/") ? rootPath : `${rootPath}/`)
}

export function extractComponents(project: Project, componentRoots: string[]): ComponentData[] {
    const rootPaths = componentRoots.map(root => path.resolve(root).replace(/\\/g, "/"))
    const selectedFiles = project.getSourceFiles().filter(sourceFile =>
        !sourceFile.isDeclarationFile() &&
        rootPaths.some(rootPath => matchesRoot(sourceFile.getFilePath().replace(/\\/g, "/"), rootPath))
    )
    const firstFile = selectedFiles[0]
    if (!firstFile) return []

    const utils = createUtils(project, path.dirname(firstFile.getFilePath()))
    try {
        return selectedFiles.flatMap(sourceFile => {
            const sourcePath = sourceFile.getFilePath().replace(/\\/g, "/")
            const exports = sourceFile.getExportSymbols().sort((left, right) =>
                Number(left.getName() === "default") - Number(right.getName() === "default")
            )
            const namedExports = new Set(exports.map(symbol => symbol.getName()).filter(name => name !== "default"))

            return exports.flatMap(publicSymbol => {
                const publicName = publicSymbol.getName()
                if (!isValueExported(sourceFile, publicName)) return []

                const symbol = resolvedSymbol(publicSymbol)
                const signature = symbol.getDeclarations().filter(isRuntimeDeclaration)
                    .map(utils.getSignature).find(isDefined)
                const isDefault = publicName === "default"
                const declarationName = isDefault ? defaultName(symbol) : publicName
                const name = isDefault && namedExports.has(declarationName) ? "default" : declarationName
                const component = utils.extractComponentData(signature, symbol, name, sourcePath, isDefault)
                return component ? [component] : []
            })
        })
    } finally {
        utils.dispose()
    }
}
