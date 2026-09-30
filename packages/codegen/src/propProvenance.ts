import { Node, Type, ts } from "ts-morph"

import type {PropProvenance} from "@reactive-forge/schema"
export type {PropProvenance} from "@reactive-forge/schema"

function nativeDeclaration(node: Node): boolean {
    const source = node.getSourceFile().getFilePath().replace(/\\/g, "/")
    if (/\/typescript\/lib\/lib\.dom(?:\.iterable)?\.d\.ts$/.test(source)) return true
    if (!/\/node_modules\/@types\/react\/(?:[^/]+\/)*index\.d\.ts$/.test(source)) return false
    const owner = node.getFirstAncestor(Node.isInterfaceDeclaration)
    return owner !== undefined && /^(?:.*HTMLAttributes|SVGAttributes|DOMAttributes|AriaAttributes|Attributes|RefAttributes|ClassAttributes)$/.test(owner.getName())
}

// Walk only the composition of the props type, never types inside its members.
// A finite standard Pick is evidence of deliberate exposure; Omit is not.
function explicitlyPicked(type: Type, name: string, seen = new Set<ts.Type>()): boolean {
    if (seen.has(type.compilerType)) return false
    seen.add(type.compilerType)
    const alias = type.getAliasSymbol()
    if (alias?.getName() === "Pick" && alias.getDeclarations().some(d =>
        /\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(d.getSourceFile().getFilePath().replace(/\\/g, "/")))) {
        const keyType = type.getAliasTypeArguments()[1]
        const keys = keyType?.isUnion() ? keyType.getUnionTypes() : keyType ? [keyType] : []
        if (keys.length > 0 && keys.every(key => key.isStringLiteral()) &&
            keys.some(key => key.getLiteralValue() === name)) return true
    }
    function visit(node: Node): boolean {
        if (Node.isParenthesizedTypeNode(node)) return visit(node.getTypeNode())
        if (Node.isIntersectionTypeNode(node) || Node.isUnionTypeNode(node))
            return node.getTypeNodes().some(visit)
        if (Node.isTypeReference(node)) {
            const raw = node.getTypeName().getSymbol()
            const symbol = raw?.getAliasedSymbol() ?? raw
            const standardPick = symbol?.getName() === "Pick" && symbol.getDeclarations().some(d =>
                /\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(d.getSourceFile().getFilePath().replace(/\\/g, "/")))
            if (standardPick) {
                const keyType = node.getTypeArguments()[1]?.getType()
                const keys = keyType?.isUnion() ? keyType.getUnionTypes() : keyType ? [keyType] : []
                return keys.length > 0 && keys.every(key => key.isStringLiteral()) &&
                    keys.some(key => key.getLiteralValue() === name)
            }
            return explicitlyPicked(node.getType(), name, seen)
        }
        return false
    }
    for (const declaration of (type.getAliasSymbol() ?? type.getSymbol())?.getDeclarations() ?? []) {
        if (Node.isTypeAliasDeclaration(declaration) && visit(declaration.getTypeNodeOrThrow())) return true
        if (Node.isInterfaceDeclaration(declaration) && declaration.getExtends().some(base =>
            explicitlyPicked(base.getType(), name, seen))) return true
    }
    return [...type.getIntersectionTypes(), ...type.getUnionTypes(), ...type.getBaseTypes()]
        .some(member => explicitlyPicked(member, name, seen))
}

export function extractPropProvenance(props: Type, name: string): PropProvenance {
    const declarations = props.getProperty(name)?.getDeclarations() ?? []
    const native = declarations.filter(nativeDeclaration)
    const origin = declarations.length === 0 ? "unknown" :
        native.length === declarations.length ? "native" : "component"
    const sources = declarations.map(declaration => {
        const owner = declaration.getFirstAncestor(ancestor =>
            Node.isInterfaceDeclaration(ancestor) || Node.isTypeAliasDeclaration(ancestor))
        return {
            sourcePath: declaration.getSourceFile().getFilePath().replace(/\\/g, "/"),
            ...(owner && (Node.isInterfaceDeclaration(owner) || Node.isTypeAliasDeclaration(owner))
                ? { typeName: owner.getName() } : {})
        }
    })
    return {
        origin,
        exposure: explicitlyPicked(props, name) || origin === "component" ? "explicit" :
            origin === "native" ? "broad" : "unknown",
        declarations: sources.filter((source, index) => sources.findIndex(other =>
            other.sourcePath === source.sourcePath && other.typeName === source.typeName) === index)
    }
}
