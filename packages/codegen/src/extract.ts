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
    applySchemaTransforms, mkST,
    ObjectTypeSchema,
    PrimitiveTypeSchema,
    SchemaTransform,
    ValueTypeSchema
} from "@reactive-forge/shared"

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

    return {
        ...schema,
        types
    }
})

const transforms: SchemaTransform[] = [
    mergeUnions
]

function createUtils(project: Project)
{
    // language=Typescript
    const source = `
        import {FC, ReactNode, JSX} from "react"
        export type ComponentReturnType = ReturnType<FC> | JSX.Element
        export type ReactNodeType = ReactNode
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

        if (signature === undefined) return null

        if (!verifySignature(signature)) return null

        const args = calculateOrDefault(() => extractParameters(signature.getParameters()[0]), null)

        if (args === null) return null

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

        if (!type.isObject()) throw new Error("Type is not an object")

        const params: ComponentData["args"] = {}

        for (const property of type.getProperties()) {
            const paramType = property.getTypeAtLocation(declaration)
            const schema = applySchemaTransforms(
                typeToSchema(paramType, declaration),
                transforms
            )
            params[property.getName()] = { ...schema, required: !property.isOptional() }
        }

        return params
    }

    function typeToSchema(type: Type, node: Node): ValueTypeSchema
    {
        if (types.ReactNodeType.isAssignableTo(type))
            return { type: "element" }

        if (type.isArray())
            return {
                type: "array",
                elementType: typeToSchema(type.getArrayElementType()!, node)
            }

        if (type.isAssignableTo(types.DateType))
            return { type: "date" }

        const literalValue = type.getLiteralValue()

        const typeFlags = type.getFlags()

        if (typeFlags & ts.TypeFlags.Union)
            return {
                type: "union",
                types: type.getUnionTypes().map(t => typeToSchema(t, node))
            }

        if (typeFlags & ts.TypeFlags.StringLike)
            return sanitizePrimitiveSchema({
                type: "string",
                value: isString(literalValue) ? literalValue : undefined
            })

        if (typeFlags & ts.TypeFlags.NumberLike)
            return sanitizePrimitiveSchema({
                type: "number",
                value: isNumber(literalValue) ? literalValue : undefined
            })

        if (typeFlags & ts.TypeFlags.BooleanLike)
            return sanitizePrimitiveSchema({
                type: "boolean",
                value: type.isAssignableTo(types.TrueType) ? true : type.isAssignableTo(types.FalseType) ? false : undefined
            })

        switch (type.getFlags()) {
            case ts.TypeFlags.Null:
                return { type: "null" }
            case ts.TypeFlags.Undefined:
                return { type: "undefined" }
            case ts.TypeFlags.Object: {
                const stringIndexType = indexTypeToSchema(type.getStringIndexType(), "string", node)

                const numberIndexType = indexTypeToSchema(type.getNumberIndexType(), "number", node)

                const indexType = stringIndexType ?? numberIndexType

                const props: ObjectTypeSchema["properties"] = {}

                for (const prop of type.getProperties())
                    props[prop.getName()] = { ...typeToSchema(prop.getTypeAtLocation(node), node), required: !prop.isOptional() }

                return {
                    type: "object",
                    properties: props,
                    index: indexType
                }
            }
            default: {
                throw new Error("Unsupported type")
            }
        }
    }

    function indexTypeToSchema(valueType: Type | undefined, keyType: "string" | "number", node: Node): ObjectTypeSchema["index"] | undefined
    {
        if (valueType === undefined) return undefined

        return {
            key: keyType,
            value: typeToSchema(valueType, node)
        }
    }

    function sanitizePrimitiveSchema(type: PrimitiveTypeSchema)
    {
        if ("value" in type && type.value === undefined)
            delete type.value

        return type
    }

    return {
        getSignature,
        extractComponentData
    }
}

export async function extractComponents(project: Project, componentRoots: string[]): Promise<ComponentData[]> {
    const utils = createUtils(project)

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