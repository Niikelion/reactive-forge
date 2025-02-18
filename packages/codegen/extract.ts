import path from "path"
import {FunctionDeclaration, Node, Project, Signature, Symbol, ts, Type, VariableDeclaration} from "ts-morph"
import {ComponentData} from "./types"
import {ObjectTypeSchema, PrimitiveTypeSchema, ValueTypeSchema} from "@reactive-forge/shared"

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

function createUtils(project: Project)
{
    // language=Typescript
    const source = `
        import {FC, ReactNode} from "react"
        export type ComponentReturnType = ReturnType<FC>
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

    function getSignature(node: Node): Signature | undefined
    {
        if (node instanceof FunctionDeclaration)
            return node.getSignature()

        if (node instanceof VariableDeclaration)
        {
            const type = node.getType()
            const callSignatures = type.getCallSignatures()

            if (callSignatures.length === 0)
                return undefined

            return callSignatures[0]
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
        if (signature === undefined) return null

        const name = symbol.getDeclarations()[0].getFirstChild(n => n.isKind(ts.SyntaxKind.Identifier))!.getText()

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

        for (const property of type.getProperties())
            params[property.getName()] = typeToSchema(property.getTypeAtLocation(declaration), declaration)

        return params
    }

    function typeToSchema(type: Type, node: Node): ValueTypeSchema
    {
        if (types.ReactNodeType.isAssignableTo(type)) return { type: "element" }

        if (type.isArray())
            return {
                type: "array",
                elementType: typeToSchema(type.getArrayElementType()!, node)
            }

        if (type.isAssignableTo(types.DateType))
            return { type: "date" }

        const literalValue = type.getLiteralValue()

        switch (type.getFlags()) {
            case ts.TypeFlags.Intersection: {
                return {
                    type: "intersection",
                    types: type.getIntersectionTypes().map(t => typeToSchema(t, node))
                }
            }
            case ts.TypeFlags.Object: {
                const props: ObjectTypeSchema["properties"] = {}

                for (const prop of type.getProperties())
                    props[prop.getName()] = { ...typeToSchema(prop.getTypeAtLocation(node), node), required: !prop.isOptional() }

                return {
                    type: "object",
                    properties: props
                }
            }
            case ts.TypeFlags.StringLiteral:
            case ts.TypeFlags.String: {
                return sanitizePrimitiveSchema({
                    type: "string",
                    value: literalValueToSchema(literalValue)
                })
            }
            case ts.TypeFlags.NumberLiteral:
            case ts.TypeFlags.Number: {
                return sanitizePrimitiveSchema({
                    type: "number",
                    value: literalValueToSchema(literalValue)
                })
            }
            case ts.TypeFlags.BooleanLiteral:
            case ts.TypeFlags.Boolean: {
                return sanitizePrimitiveSchema({
                    type: "boolean",
                    value: type.isAssignableTo(types.TrueType) ? true : type.isAssignableTo(types.FalseType) ? false : undefined
                })
            }
            default: throw new Error("Unsupported type")
        }
    }

    function literalValueToSchema(value: ReturnType<Type["getLiteralValue"]>): PrimitiveTypeSchema["value"]
    {
        if (value === undefined || isString(value) || isNumber(value)) return value

        if ("negative" in value) return undefined
    }

    function sanitizePrimitiveSchema(type: PrimitiveTypeSchema)
    {
        if (type.value === undefined)
            delete type.value

        return type
    }

    return {
        getSignature,
        extractComponentData
    }
}

export async function extractComponents(project: Project, rootDir: string): Promise<ComponentData[]> {
    const utils = createUtils(project)

    const rootPath = path.resolve(rootDir).replace(/\\/g, "/")

    return project.getSourceFiles().map(sourceFile => {
        if (!sourceFile.getFilePath().startsWith(rootPath)) return []

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