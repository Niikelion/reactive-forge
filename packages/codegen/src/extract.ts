import path from "path"
import {existsSync} from "fs"
import {
    ExportAssignment,
    ExportSpecifier,
    FunctionDeclaration,
    JSDocableNode,
    Node,
    ObjectLiteralExpression,
    ParameterDeclaration,
    Project,
    Signature,
    SourceFile,
    Symbol,
    ts,
    Type,
    VariableDeclaration
} from "ts-morph"
import {ComponentData, PropExtra} from "./types.js"
import {Diagnostic, ValueJson} from "./metadataTypes.js"
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
    UnknownSchema,
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

// Reports a diagnostic against whatever prop/component-level bucket the
// current typeToSchema call chain is scoped to. Severity is bound by the
// caller (required prop -> "error", optional prop -> "warning") so nested
// calls (array elements, union/intersection members, index signatures) all
// land in the same bucket at the severity appropriate for the prop they
// belong to.
type Report = (code: string, message: string, location?: Diagnostic["location"]) => void

function locationOf(node: Node): Diagnostic["location"] {
    const sourceFile = node.getSourceFile()
    const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart())
    return { sourcePath: sourceFile.getFilePath().replace(/\\/g, "/"), line, column }
}

interface PropSink {
    onProperty(name: string, declaration: Node | undefined, diagnostics: Diagnostic[]): void
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

    // Leading JSDoc comment text on a node that supports it (component
    // declaration or a prop's property-signature member). Returns undefined
    // (never an empty string) when there is no doc comment, per contract.
    function jsDocHost(node: Node): Node {
        if (Node.isVariableDeclaration(node)) return node.getVariableStatement() ?? node
        return node
    }

    function extractJsDoc(node: Node | undefined): string | undefined {
        if (node === undefined) return undefined
        const host = jsDocHost(node) as unknown as Partial<JSDocableNode>
        if (typeof host.getJsDocs !== "function") return undefined
        const docs = host.getJsDocs()
        if (docs.length === 0) return undefined
        const text = docs.map(doc => doc.getDescription().trim()).filter(t => t.length > 0).join("\n\n")
        return text.length > 0 ? text : undefined
    }

    // `<Component>.defaultProps = { ... }`-style static, matched by simple
    // AST scan for an assignment expression in the same source file. Only a
    // plain object literal assigned directly is recognised.
    function findDefaultPropsLiteral(sourceFile: SourceFile, componentName: string): ObjectLiteralExpression | undefined {
        for (const statement of sourceFile.getStatements()) {
            if (!Node.isExpressionStatement(statement)) continue
            const expression = statement.getExpression()
            if (!Node.isBinaryExpression(expression)) continue
            if (expression.getOperatorToken().getKind() !== ts.SyntaxKind.EqualsToken) continue
            const left = expression.getLeft()
            if (!Node.isPropertyAccessExpression(left)) continue
            if (left.getName() !== "defaultProps") continue
            if (left.getExpression().getText() !== componentName) continue
            const right = expression.getRight()
            if (Node.isObjectLiteralExpression(right)) return right
        }
        return undefined
    }

    // Destructured-parameter defaults, e.g. `({ size = "medium" }: Props)`.
    // Keyed by the declared prop name (not the local binding name, which can
    // differ under `{ size: localSize = "medium" }`).
    function collectDestructuredDefaults(paramNode: ParameterDeclaration | undefined): Map<string, Node> {
        const result = new Map<string, Node>()
        if (paramNode === undefined) return result
        const nameNode = paramNode.getNameNode()
        if (!Node.isObjectBindingPattern(nameNode)) return result

        for (const element of nameNode.getElements()) {
            const initializer = element.getInitializer()
            if (!initializer) continue
            const propertyName = element.getPropertyNameNode()
            const key = propertyName ? propertyName.getText().replace(/^["']|["']$/g, "") : element.getName()
            result.set(key, initializer)
        }
        return result
    }

    // Parses a literal (or plain literal-only array/object of literals)
    // expression AST node directly into ValueJson. Never evaluates code:
    // anything that is not one of these forms (function calls, spreads,
    // identifiers/references, template substitutions, etc.) returns
    // undefined so the caller can emit a "default-unsupported" diagnostic.
    function parseLiteralValue(expression: Node): ValueJson | undefined {
        if (Node.isNullLiteral(expression)) return { type: "null" }
        if (expression.getKind() === ts.SyntaxKind.TrueKeyword) return { type: "boolean", value: true }
        if (expression.getKind() === ts.SyntaxKind.FalseKeyword) return { type: "boolean", value: false }
        if (Node.isIdentifier(expression) && expression.getText() === "undefined") return { type: "undefined" }

        if (Node.isNumericLiteral(expression)) return { type: "number", value: expression.getLiteralValue() }
        if (Node.isBigIntLiteral(expression))
            return { type: "bigint", value: expression.getLiteralText().replace(/n$/, "") }

        if (Node.isPrefixUnaryExpression(expression) && expression.getOperatorToken() === ts.SyntaxKind.MinusToken) {
            const operand = expression.getOperand()
            if (Node.isNumericLiteral(operand)) return { type: "number", value: -operand.getLiteralValue() }
            if (Node.isBigIntLiteral(operand))
                return { type: "bigint", value: `-${operand.getLiteralText().replace(/n$/, "")}` }
            return undefined
        }

        if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression))
            return { type: "string", value: expression.getLiteralValue() }

        if (Node.isArrayLiteralExpression(expression)) {
            const values: ValueJson[] = []
            for (const element of expression.getElements()) {
                const parsed = parseLiteralValue(element)
                if (parsed === undefined) return undefined
                values.push(parsed)
            }
            return { type: "array", value: values }
        }

        if (Node.isObjectLiteralExpression(expression)) {
            const value: Record<string, ValueJson> = {}
            for (const property of expression.getProperties()) {
                if (!Node.isPropertyAssignment(property)) return undefined
                const nameNode = property.getNameNode()
                const key = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() :
                    Node.isIdentifier(nameNode) ? nameNode.getText() : undefined
                if (key === undefined) return undefined
                const initializer = property.getInitializer()
                if (!initializer) return undefined
                const parsed = parseLiteralValue(initializer)
                if (parsed === undefined) return undefined
                value[key] = parsed
            }
            return { type: "object", value }
        }

        return undefined
    }

    function extractComponentData(signature: Signature | undefined, declarationNode: Node | undefined, symbol: Symbol, name: string, sourcePath: string, isDefault: boolean): ComponentData | null
    {
        if (signature === undefined) return null

        if (!verifySignature(signature)) return null

        const componentDiagnostics: Diagnostic[] = []
        const { args, propMeta } = calculateOrDefault(
            () => extractParameters(signature, componentDiagnostics, name),
            { args: {}, propMeta: {} } as { args: ComponentData["args"], propMeta: ComponentData["propMeta"] }
        )

        return {
            symbol,
            name,
            sourcePath,
            isDefault,
            args,
            propMeta,
            description: extractJsDoc(declarationNode),
            diagnostics: componentDiagnostics
        }
    }

    function extractParameters(signature: Signature, componentDiagnostics: Diagnostic[], componentName: string): { args: ComponentData["args"], propMeta: ComponentData["propMeta"] }
    {
        const declarationNode = calculateOrDefault(() => signature.getDeclaration(), undefined) as
            (Node & Partial<{ getParameters(): ParameterDeclaration[] }>) | undefined
        const paramNode = declarationNode?.getParameters?.()[0]

        if (paramNode === undefined) return { args: {}, propMeta: {} }

        let type: Type
        try {
            type = paramNode.getType()
        } catch (error) {
            componentDiagnostics.push({
                severity: "error",
                code: "unresolved-signature",
                message: `Could not resolve the props parameter type: ${error instanceof Error ? error.message : String(error)}`,
                location: locationOf(paramNode)
            })
            return { args: {}, propMeta: {} }
        }

        const propMeta: Record<string, PropExtra> = {}
        const collectedProps: { name: string, declaration: Node | undefined, diagnostics: Diagnostic[] }[] = []
        const propSink: PropSink = {
            onProperty(name, declaration, diagnostics) {
                collectedProps.push({ name, declaration, diagnostics })
            }
        }

        let paramsSchema: Schema
        try {
            paramsSchema = typeToSchema(type, paramNode, () => { /* whole-props-type failures are reported below */ }, propSink)
        } catch (error) {
            componentDiagnostics.push({
                severity: "error",
                code: "unresolved-signature",
                message: `Could not resolve props type: ${error instanceof Error ? error.message : String(error)}`,
                location: locationOf(paramNode)
            })
            return { args: {}, propMeta: {} }
        }

        if (!(paramsSchema instanceof ObjectSchema)) {
            componentDiagnostics.push({
                severity: "error",
                code: "props-not-object",
                message: `Component props type is not an object type: ${type.getText()}`,
                location: locationOf(paramNode)
            })
            return { args: {}, propMeta: {} }
        }

        const destructuredDefaults = collectDestructuredDefaults(paramNode)
        const staticDefaults = calculateOrDefault(
            () => findDefaultPropsLiteral(paramNode.getSourceFile(), componentName),
            undefined
        )

        for (const { name, declaration, diagnostics } of collectedProps) {
            const description = extractJsDoc(declaration)
            const defaultExprNode = destructuredDefaults.get(name) ??
                staticDefaults?.getProperty(name)?.asKind(ts.SyntaxKind.PropertyAssignment)?.getInitializer()

            let defaultValue: ValueJson | undefined
            const localDiagnostics = [...diagnostics]
            if (defaultExprNode) {
                const parsed = parseLiteralValue(defaultExprNode)
                if (parsed !== undefined) defaultValue = parsed
                else localDiagnostics.push({
                    severity: "warning",
                    code: "default-unsupported",
                    message: `Default value for "${name}" is not a supported literal: ${defaultExprNode.getText()}`,
                    location: locationOf(defaultExprNode)
                })
            }

            propMeta[name] = {
                ...(description !== undefined ? { description } : {}),
                ...(defaultValue !== undefined ? { defaultValue } : {}),
                diagnostics: localDiagnostics
            }

            const required = paramsSchema.properties[name]?.required ?? false
            if (required && localDiagnostics.some(d => d.severity === "error")) {
                componentDiagnostics.push({
                    severity: "error",
                    code: "unsupported-type",
                    message: `Required prop "${name}" has an unsupported type and could not be fully represented`,
                    location: locationOf(paramNode)
                })
            }
        }

        return { args: paramsSchema.properties, propMeta }
    }

    function typeToSchema(type: Type, node: Node, report: Report, propSink?: PropSink): Schema
    {
        if (types.ReactNodeType.isAssignableTo(type))
            return ReactNodeSchema.instance

        if (type.isArray()) {
            const elementType = type.getArrayElementType()
            if (!elementType) {
                report("unsupported-type", `Could not determine array element type: ${type.getText()}`, locationOf(node))
                return new ArraySchema([], new UnknownSchema())
            }
            return new ArraySchema([], typeToSchema(elementType, node, report))
        }

        if (type.isAssignableTo(types.DateType))
            return DateSchema.instance

        const literalValue = type.getLiteralValue()
        const typeFlags = type.getFlags()

        if (typeFlags & ts.TypeFlags.Union) {
            const members = type.getUnionTypes().map(t => typeToSchema(t, node, report))
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
                .map(t => typeToSchema(t, node, report))
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
                const indexType = indexTypeToSchema(type.getStringIndexType(), node, report)

                const properties: ObjectSchema["properties"] = {}

                for (const prop of type.getProperties()) {
                    const required = !prop.isOptional()
                    const propType = calculateOrDefault(() => prop.getTypeAtLocation(node), undefined)

                    if (propSink) {
                        // Top-level component prop: isolate diagnostics per
                        // prop so required/optional severity and reporting
                        // stay scoped to that single prop.
                        const severity: Diagnostic["severity"] = required ? "error" : "warning"
                        const localDiagnostics: Diagnostic[] = []
                        const localReport: Report = (code, message, location) =>
                            localDiagnostics.push({ severity, code, message, location })

                        const schema = propType !== undefined
                            ? typeToSchema(propType, node, localReport)
                            : (localReport("unsupported-type", `Could not resolve type of prop "${prop.getName()}"`, locationOf(node)), new UnknownSchema())

                        properties[prop.getName()] = { schema, required }
                        propSink.onProperty(prop.getName(), prop.getDeclarations()[0], localDiagnostics)
                    } else {
                        const schema = propType !== undefined
                            ? typeToSchema(propType, node, report)
                            : (report("unsupported-type", `Could not resolve type of prop "${prop.getName()}"`, locationOf(node)), new UnknownSchema())
                        properties[prop.getName()] = { schema, required }
                    }
                }

                return new ObjectSchema(properties, indexType)
            }
            default: {
                report("unsupported-type", `Unsupported type: ${type.getText()}`, locationOf(node))
                return new UnknownSchema()
            }
        }
    }

    function indexTypeToSchema(valueType: Type | undefined, node: Node, report: Report): Schema | undefined
    {
        if (valueType === undefined) return undefined
        return typeToSchema(valueType, node, report)
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
                const declarationEntry = symbol.getDeclarations().filter(isRuntimeDeclaration)
                    .map(declaration => ({ declaration, signature: utils.getSignature(declaration) }))
                    .find(entry => isDefined(entry.signature))
                const signature = declarationEntry?.signature
                const isDefault = publicName === "default"
                const declarationName = isDefault ? defaultName(symbol) : publicName
                const name = isDefault && namedExports.has(declarationName) ? "default" : declarationName
                const component = utils.extractComponentData(signature, declarationEntry?.declaration, symbol, name, sourcePath, isDefault)
                return component ? [component] : []
            })
        })
    } finally {
        utils.dispose()
    }
}
