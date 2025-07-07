import path from "path"
import {
    ExportAssignment,
    FunctionDeclaration,
    Node,
    Project,
    Signature,
    Symbol,
    ts,
    Type,
    VariableDeclaration
} from "ts-morph"
import {ComponentData} from "./types"
import {
    applySchemaTransforms, intersectionOfSchemas, isBigInt, mkST,
    ObjectTypeSchema,
    s,
    SchemaTransform,
    ValueTypeSchema
} from "@reactive-forge/shared"
import {Logger} from "./utils";

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

const mergeUnions = mkST(schema => {
    if (schema.type !== "union") return null

    const types: ValueTypeSchema[] = []

    schema.types.forEach(type => {
        if (type.type !== schema.type) {
            types.push(type)
            return
        }

        type.types.forEach(t => types.push(t))
    })

    return s.union(...types)
})

const cleanupLiterals = mkST(schema => {
    switch (schema.type) {
        case "boolean":
        case "number":
        case "bigint":
        case "string": {
            if (schema.value === undefined)
                return { type: schema.type }
            return schema
        }
        case "union": {
            if (!schema.types.some(t => t.type === "boolean" && t.value === true) || !schema.types.some(t => t.type === "boolean" && t.value === false))
                return null

            const types = [...schema.types.filter(t => t.type !== "boolean"), s.boolean(undefined)]
            if (types.length === 0) return s.never()
            return s.union(...types)
        }
        default: return null
    }
})

const stripOptionalUndefined = mkST(schema => {
    if (schema.type !== "object") return null

    const properties = Object.fromEntries([...Object.entries(schema.properties)].filter(([, p]) => p.required || p.type !== "undefined").map(([k, p]) => {
        if (p.required || (p.type !== "union" || !p.types.some(p => p.type === "undefined"))) return [k, p]

        const types = p.types.filter(p => p.type !== "undefined")

        return [k, { required: false, ...s.union(...types) }]
    }))
    const index = schema.index?.type !== "undefined" ? schema.index : undefined
    return s.object(properties, index)
})

const stripNever = mkST(schema => {
    switch (schema.type) {
        case "union": {
            const types = schema.types.filter(t => t.type !== "never")
            if (types.length === 0) return s.never()
            if (types.length === schema.types.length) return null
            return s.union(...types)
        }
        case "object": {
            const properties = Object.entries(schema.properties)
            const index = schema.index

            const strippedProperties = properties.filter(([_, t]) => t.required || t.type !== "never")

            return s.object(Object.fromEntries(strippedProperties), index?.type !== "never" ? index : undefined)
        }
        default: return null
    }
})

const stripSingleElementUnions = mkST(schema => {
    if (schema.type !== "union") return null
    if (schema.types.length === 1) return schema.types[0]
    return null
})

const transforms: SchemaTransform[] = [
    mergeUnions,
    cleanupLiterals,
    stripOptionalUndefined,
    stripNever,
    stripSingleElementUnions
]

class CyclicError extends Error {
    readonly symbol: Symbol

    constructor(message: string, symbol: Symbol) {
        super(message)
        this.symbol = symbol
    }
}

function createUtils(project: Project, logger: Logger)
{
    const source = `
        import {FC, ReactNode, JSX, CSSProperties} from "react"
        export type ComponentReturnType = ReturnType<FC> | JSX.Element
        export type ReactNodeType = ReactNode
        export type CSSPropertiesType = CSSProperties
        export type HTMLElementType = HTMLElement
        export type DateType = Date
        export type TrueType = true
        export type FalseType = false
    `

    const tmpSourceFile = project.createSourceFile("./__reactive_forge_utils_tmp_file.ts", source)
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

    const types = extractTypes(
        "ComponentReturnType",
        "ReactNodeType",
        "CSSPropertiesType",
        "HTMLElementType",
        "DateType",
        "TrueType",
        "FalseType"
    )

    if (project.getTypeChecker().getTypeText(types.ReactNodeType) === "any")
        throw new Error("[reactive-forge]: Cannot find react types!")

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

    function extractComponentData(signature: Signature | undefined, symbol: Symbol, isDefault: boolean): ComponentData | null
    {
        const name = symbol.getDeclarations()[0].getFirstChild(n => n.isKind(ts.SyntaxKind.Identifier))!.getText()

        logger.debug(`Extracting "${name}"`)

        if (signature === undefined) {
            logger.debug("No signature")
            return null
        }

        if (!verifySignature(signature)) {
            logger.debug("Unsupported signature type")
            return null
        }

        const args = calculateOrDefault(() => {
            try {
                return extractParameters(signature.getParameters()[0])
            } catch (err) {
                if (err instanceof Error) {
                    if (err.stack)
                        logger.debug(err.stack)
                    logger.debug(err.toString())
                }
                else
                    logger.debug(JSON.stringify(err))
                throw err
            }
        }, null)

        if (args === null) {
            logger.debug("Failed to extract parameters")
            return null
        }

        logger.debug(`Finished extracting "${name}"`)

        return {
            symbol,
            name,
            isDefault,
            args
        }
    }

    function extractParameters(propsSymbol: Symbol | undefined): ComponentData["args"]
    {
        if (propsSymbol === undefined) return {}

        const declaration = propsSymbol.getDeclarations()[0]

        const type = propsSymbol.getTypeAtLocation(declaration)

        const paramsSchema = applySchemaTransforms(typeToSchema(type, declaration, new Set<Symbol>(), "$"), transforms)

        if (paramsSchema.type !== "object") {
            logger.debug(`Wrong type of the first parameter, expected object, got ${paramsSchema.type}`)
            throw new Error("Props type is not an object")
        }

        return paramsSchema.properties
    }

    function typeToSchema(type: Type, node: Node, visited: Set<Symbol>, path: string): ValueTypeSchema
    {
        const symbol = type.getSymbol()

        if (symbol) {
            if (visited.has(symbol)) throw new CyclicError("Detected circular type", symbol)
            visited.add(symbol)
        }

        try {
            if (types.ReactNodeType.isAssignableTo(type))
                return s.element()
            if (types.CSSPropertiesType.isAssignableTo(type) && type.isAssignableTo(types.CSSPropertiesType)) {
                logger.debug(`${path}: CSSProperties detected, but not supported`)
                return s.object({})
            }
            if (type.isAssignableTo(types.HTMLElementType)) {
                logger.debug(`${path}: HTMLElement detected, but not supported`)
                return s.never()
            }

            if (type.isClass()) {
                logger.debug(`${path}: class detected, but not supported`)
                return s.never()
            }

            const signature = type.getCallSignatures()[0]

            if (signature !== undefined) {
                //const argumentTypes = signature.getParameters().map((p, i) => typeToSchema(p.getTypeAtLocation(node), node, visited, `${path}(${i}:${p.getName()})`))
                const returnType = typeToSchema(signature.getReturnType(), node, visited, `${path}(R)`)

                return s.never()
                // return s.function(returnType)
            }

            if (type.isTuple()) {
                const tupleElements = type.getTupleElements()!

                const hasElementType = type.getProperty((tupleElements.length - 1).toString()) === undefined

                const tupleTypes = tupleElements.map((t, i) => typeToSchema(t, node, visited, `${path}[${i === tupleElements.length - 1 && hasElementType ? "number" : i}]`))
                const elementType = hasElementType ? tupleTypes.splice(tupleTypes.length - 1, 1)[0] : undefined

                return {
                    type: "array",
                    tupleTypes,
                    elementType
                }
            }
            if (type.isArray())
                return s.array(typeToSchema(type.getArrayElementType()!, node, visited, `${path}[]`))
            if (type.isAssignableTo(types.DateType))
                return s.date()

            const literalValue = type.getLiteralValue()

            const typeFlags = type.getFlags()

            if (type.isIntersection())
                return intersectionOfSchemas(...type.getIntersectionTypes().map((t, i) => typeToSchema(t, node, visited, `${path}&>${i}`)))

            if (typeFlags & ts.TypeFlags.StringLike)
                return s.string(isString(literalValue) ? literalValue : undefined)
            if (typeFlags & ts.TypeFlags.BigIntLike)
                return s.bigint(isBigInt(literalValue) ? literalValue : undefined)
            if (typeFlags & ts.TypeFlags.NumberLike)
                return s.number(isNumber(literalValue) ? literalValue : undefined)
            if (typeFlags & ts.TypeFlags.BooleanLike)
                return s.boolean(type.isAssignableTo(types.TrueType) ? true : type.isAssignableTo(types.FalseType) ? false : undefined)
            if (type.isUnion())
                return s.union(...type.getUnionTypes().map((t, i) => typeToSchema(t, node, visited, `${path}|>${i}`)))
            if (type.isVoid()) return s.void()
            if (type.isNever()) return s.never()
            if (type.isAny()) return s.any()
            if (type.isUnknown()) return s.unknown()
            if (type.isUndefined()) return s.undefined()
            if (type.isNull()) return s.null()
            if (type.isObject()) {
                const index = indexTypeToSchema(type.getStringIndexType(), node, visited, `${path}[string]`)
                const properties: ObjectTypeSchema["properties"] = {}

                for (const prop of type.getProperties()) {
                    const required = !prop.isOptional()
                    properties[prop.getName()] = {...typeToSchema(prop.getTypeAtLocation(node), node, visited, `${path}.${prop.getName()}`), required}
                }

                return s.object(properties, index)
            }
            // type not found
            logger.debug(`${path}: Could not handle type: ${type.getText(node)}`)
            return s.never()
        } catch (err) {
            if (err instanceof CyclicError && err.symbol === symbol) {
                logger.debug(`${path}: Could not handle cyclic type: ${type.getText(node)}`)
                return s.never()
            }
            throw err
        } finally {
            if (symbol !== undefined) visited.delete(symbol)
        }
    }

    function indexTypeToSchema(valueType: Type | undefined, node: Node, visited: Set<Symbol>, path: string): ValueTypeSchema | undefined
    {
        if (valueType === undefined) return undefined

        return typeToSchema(valueType, node, visited, path)
    }

    return {
        getSignature,
        extractComponentData
    }
}

export async function extractComponents(project: Project, componentRoots: string[], logger: Logger): Promise<ComponentData[]> {
    const utils = createUtils(project, logger)

    const rootPaths = componentRoots.map(rootDir => path.resolve(rootDir).replace(/\\/g, "/"))

    return project.getSourceFiles().map(sourceFile => {
        const sourceFilePath = sourceFile.getFilePath()
        if (!rootPaths.some(rootPath => sourceFilePath.startsWith(rootPath)))
            return []

        const exportNames = sourceFile.getExportDeclarations().map(declaration => {
            const modulePath = declaration.getModuleSpecifier()

            // skip if this is just re-export
            if (modulePath != undefined) return null

            return declaration.getNamedExports().map(namedExport => {
                const symbol = namedExport.getSymbol()
                if (!symbol) return null

                const declarations = symbol.getDeclarations()

                return utils.extractComponentData(declarations.map(utils.getSignature).filter(isDefined)[0], symbol, false)
            }).flat()
        }).flat()

        const defaultExportSymbol = sourceFile.getDefaultExportSymbol()

        const defaultExports = (defaultExportSymbol !== undefined ? [defaultExportSymbol] : []).map(defaultExport => {
            const declarations = defaultExport.getDeclarations()

            return utils.extractComponentData(declarations.map(utils.getSignature).filter(isDefined)[0], defaultExport, true)
        })

        const variableDeclaration = sourceFile.getVariableDeclarations().map(declaration => {
            if (!declaration.isExported()) return null

            const symbol = declaration.getSymbol()

            if (symbol === undefined) return null

            return utils.extractComponentData(utils.getSignature(declaration), symbol, false)
        })

        return [exportNames, variableDeclaration, defaultExports].flat().filter(isDefined)
    }).flat()
}